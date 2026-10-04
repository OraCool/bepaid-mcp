import type { Transaction } from "../bepaid/types.js";
import type { Group, Roster, Payer } from "../roster/loadRoster.js";

export type Resolution = { payer: Payer; resolvedBy: "price" | "date"; meeting?: string };

const DAY_MS = 24 * 3600 * 1000;

/**
 * A payer enrolled in several groups: pick the group the payment belongs to.
 * 1. Price: the amount must be the module price × n (n ≥ 1) in the payment currency.
 *    One fitting group wins; several fitting groups (same price) go to the date rule;
 *    none fitting means the amount is unexpected and is left for manual review.
 *    The price rule applies only when every candidate group has a price in that currency.
 * 2. Date: the group with a module date nearest to the payment date wins (ties are not resolved).
 *    Applies only when every remaining group has module dates.
 * Returns undefined when no rule decides; the payment is then reported as ambiguous.
 */
export function resolveAmbiguity(candidates: Payer[], tx: Transaction, roster: Roster): Resolution | undefined {
  const entries = candidates.flatMap((payer) => {
    const group = roster.groups.find((g) => g.code === payer.groupCode);
    return group ? [{ payer, group }] : [];
  });
  if (entries.length !== candidates.length) return undefined;

  let pool = entries;
  const prices = entries.map(({ group }) => modulePrices(group, tx.currency));
  if (prices.every((p) => p.length > 0)) {
    pool = entries.filter((_, i) => prices[i]!.some((price) => tx.amount % price === 0));
    if (pool.length === 0) return undefined;
    if (pool.length === 1) return { payer: pool[0]!.payer, resolvedBy: "price" };
  }

  const paidAt = Date.parse(tx.paid_at ?? tx.created_at ?? "");
  if (Number.isNaN(paidAt)) return undefined;
  const nearest = pool.map((entry) => ({ ...entry, ...nearestModule(entry.group, paidAt) }));
  if (nearest.some((n) => n.distance === undefined)) return undefined;
  nearest.sort((a, b) => a.distance! - b.distance!);
  const [best, second] = nearest;
  if (!best || (second && second.distance === best.distance)) return undefined;
  return { payer: best.payer, resolvedBy: "date", meeting: best.meeting };
}

function modulePrices(group: Group, currency: string): number[] {
  return group.modules
    .filter((m) => m.currency === currency.toUpperCase() && m.priceMinor)
    .map((m) => m.priceMinor!);
}

// Distance in whole days, so a payment on the module day itself is 0 regardless of time of day.
function nearestModule(group: Group, paidAt: number): { distance?: number; meeting?: string } {
  const paidDay = Math.floor(paidAt / DAY_MS);
  let result: { distance?: number; meeting?: string } = {};
  for (const module of group.modules) {
    if (!module.date) continue;
    const distance = Math.abs(Math.floor(Date.parse(module.date) / DAY_MS) - paidDay);
    if (result.distance === undefined || distance < result.distance) result = { distance, meeting: module.meeting };
  }
  return result;
}
