import { nameTokens, normalizeEmail, normalizePhone } from "../matching/normalize.js";
import { groupSlug } from "../matching/trackingId.js";
import type { Group, Roster, Payer } from "./loadRoster.js";

/** Group by exact code, or by slug so "альфа 25.1", "Альфа-25.1" and "alfa-25.1" all work. */
export function findGroup(roster: Roster, query: string): Group | undefined {
  const slug = groupSlug(query);
  return roster.groups.find((g) => g.code === query.trim()) ?? roster.groups.find((g) => g.slug === slug);
}

/** Payers matching an id, email, phone or (partial, any order) name. */
export function findPayers(roster: Roster, query: string, groupCode?: string): Payer[] {
  const pool = groupCode ? roster.payers.filter((s) => s.groupCode === groupCode) : roster.payers;
  const text = query.trim();

  const byId = pool.filter((s) => s.id === text);
  if (byId.length) return byId;

  const email = normalizeEmail(text);
  if (email) return pool.filter((s) => s.email === email);

  const phone = /^[+\d\s()-]+$/.test(text) ? normalizePhone(text) : undefined;
  if (phone) return pool.filter((s) => s.phone === phone);

  const wanted = nameTokens(text);
  if (wanted.size === 0) return [];
  return pool.filter((s) => {
    const known = [...nameTokens(s.name), ...nameTokens(s.latinName), ...nameTokens(s.fullName)];
    return [...wanted].every((w) => known.some((k) => k.startsWith(w)));
  });
}
