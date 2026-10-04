import type { Transaction } from "../bepaid/types.js";
import { findGroup, findPayers } from "../roster/findPayers.js";
import { normalizeProgram, type Roster, type Payer } from "../roster/loadRoster.js";
import { nameTokens, normalizeEmail, normalizePhone, similarNameTokens } from "./normalize.js";
import { resolveAmbiguity } from "./resolveAmbiguity.js";
import { decodeTrackingId } from "./trackingId.js";

export type MatchMethod = "manual" | "tracking_id" | "email" | "phone" | "name" | "name_fuzzy";

export type MatchResult =
  | { status: "matched"; payer: Payer; by: MatchMethod; meeting?: string; resolvedBy?: "price" | "date" }
  | { status: "ambiguous"; by: MatchMethod; candidates: Payer[] }
  | { status: "other_program"; program: string }
  | { status: "unmatched"; reason?: string };

/**
 * Maps a bePaid transaction to a roster payer:
 * 1. manual assignment by transaction uid;
 * 2. tracking_id of links created by this server;
 * 3. payment description → only groups of that program (column "Программа");
 * 4. payer email → phone → name → name with Belarusian/Russian spelling differences.
 * The first identity strategy that finds any candidate decides the outcome.
 */
export function matchTransaction(tx: Transaction, roster: Roster): MatchResult {
  const manual = roster.manual.find((m) => m.uid === tx.uid);
  if (manual) return applyManual(manual, roster);

  const tracking = decodeTrackingId(tx.tracking_id);
  if (tracking) {
    const payer = roster.payers.find(
      (s) => s.key === tracking.payerKey && roster.groups.some((g) => g.code === s.groupCode && g.slug === tracking.groupSlug),
    );
    if (payer) return { status: "matched", payer, by: "tracking_id", meeting: tracking.meeting };
  }

  const groupCodes = groupsForProgram(tx.description, roster);
  if (groupCodes.size === 0) return { status: "other_program", program: tx.description ?? "" };
  const pool = roster.payers.filter((s) => groupCodes.has(s.groupCode));

  const strategies: [MatchMethod, () => Payer[]][] = [
    ["email", () => byEmail(tx, pool)],
    ["phone", () => byPhone(tx, pool)],
    ["name", () => byName(tx, pool, (a, b) => a === b)],
    ["name_fuzzy", () => byName(tx, pool, similarNameTokens)],
  ];
  for (const [by, find] of strategies) {
    const candidates = find();
    if (candidates.length === 0) continue;
    // Email/phone identify one person; a name may fit several different people.
    if ((by === "name" || by === "name_fuzzy") && new Set(candidates.map(personOf)).size > 1) {
      return { status: "ambiguous", by, candidates };
    }
    if (new Set(candidates.map((s) => s.groupCode)).size === 1) return { status: "matched", payer: candidates[0]!, by };
    const resolved = resolveAmbiguity(candidates, tx, roster);
    return resolved ? { status: "matched", by, ...resolved } : { status: "ambiguous", by, candidates };
  }
  return { status: "unmatched" };
}

function applyManual(manual: Roster["manual"][number], roster: Roster): MatchResult {
  const where = `"Ручные сопоставления" row ${manual.row}`;
  const group = findGroup(roster, manual.group);
  if (!group) return { status: "unmatched", reason: `${where}: unknown group "${manual.group}"` };
  const payers = findPayers(roster, manual.payer, group.code);
  if (payers.length !== 1) {
    return {
      status: "unmatched",
      reason: `${where}: "${manual.payer}" matches ${payers.length} payers in ${group.code}`,
    };
  }
  return { status: "matched", payer: payers[0]!, by: "manual", meeting: manual.meeting };
}

/**
 * Groups whose program fits the payment description. Groups without a "Программа" value always stay
 * possible; an empty result means the payment is for a program no group has (e.g. an individual consultation).
 */
function groupsForProgram(description: string | null | undefined, roster: Roster): Set<string> {
  const program = normalizeProgram(description);
  return new Set(
    roster.groups.filter((g) => g.programs.length === 0 || (program && g.programs.includes(program))).map((g) => g.code),
  );
}

function byEmail(tx: Transaction, pool: Payer[]): Payer[] {
  const email = normalizeEmail(tx.customer?.email);
  return email ? pool.filter((s) => s.email === email) : [];
}

function byPhone(tx: Transaction, pool: Payer[]): Payer[] {
  const phone = normalizePhone(tx.billing_address?.phone);
  return phone ? pool.filter((s) => s.phone === phone) : [];
}

// Payer name from billing address, else card holder (often Latin, e.g. "ANNA IVANOVA").
// Requires at least two tokens (first + last name) and each of them to fit a token of one of the payer's names.
function byName(tx: Transaction, pool: Payer[], same: (a: string, b: string) => boolean): Payer[] {
  const billing = [tx.billing_address?.first_name, tx.billing_address?.last_name].filter(Boolean).join(" ");
  const payer = nameTokens(billing || tx.credit_card?.holder);
  if (payer.size < 2) return [];
  return pool.filter((s) => {
    const known = [...nameTokens(s.name), ...nameTokens(s.latinName), ...nameTokens(s.fullName)];
    return [...payer].every((token) => known.some((k) => same(token, k)));
  });
}

/** The same person appears in several group sheets; identify them by their display name. */
function personOf(payer: Payer): string {
  return [...nameTokens(payer.name)].sort((a, b) => a.localeCompare(b)).join(" ");
}
