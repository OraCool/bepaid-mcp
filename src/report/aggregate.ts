import type { Transaction } from "../bepaid/types.js";
import { type MatchMethod, type MatchResult, matchTransaction } from "../matching/match.js";
import { fromMinorUnits } from "../money.js";
import type { Payer, Roster } from "../roster/loadRoster.js";
import { type PaymentOrigin, paymentOrigin } from "./origin.js";

export interface PaymentRow {
  uid: string;
  createdAt?: string;
  paidAt?: string; // only set when the transaction was paid
  amount: string; // major units, "550.00"
  currency: string;
  description?: string;
  trackingId?: string;
  payerEmail?: string;
  payerName?: string;
  cardLast4?: string;
  paymentMethod?: string; // credit_card | erip | alternative
  issuerCountry?: string; // country of the card-issuing bank; "BY" for ERIP
  issuerBank?: string;
  origin: PaymentOrigin;
  test: boolean;
  matchedBy?: MatchMethod;
  resolvedBy?: "price" | "date"; // how a payer enrolled in several groups was assigned
  meeting?: string;
  note?: string; // why an unmatched payment could not be assigned
}

export interface PayerPayments {
  payerId: string;
  name: string;
  email?: string;
  payments: PaymentRow[];
  totals: Record<string, string>; // currency -> sum
}

export interface GroupPayments {
  groupCode: string;
  payers: PayerPayments[];
  totals: Record<string, string>;
  foreignTotals: Record<string, string>; // part of totals paid from foreign banks
  paymentCount: number;
}

export interface OriginSummary {
  count: number;
  totals: Record<string, string>;
}

export interface GroupReport {
  groups: GroupPayments[];
  ambiguous: (PaymentRow & { candidates: { payerId: string; name: string; groupCode: string }[] })[];
  unmatched: PaymentRow[];
  otherPrograms: PaymentRow[]; // payments for programs no group has (e.g. individual consultations)
  // All reported payments by bank origin, regardless of matching: foreign ones must be declared to the bank.
  origins: Record<PaymentOrigin, OriginSummary>;
  foreignByCountry: Record<string, OriginSummary>;
  totals: Record<string, string>;
  transactionCount: number;
}

/** Only real incoming payments are reported (refunds/authorizations are excluded). */
export function isIncomingPayment(tx: Transaction): boolean {
  return (tx.type ?? "payment") === "payment" && tx.status === "successful";
}

export function toPaymentRow(tx: Transaction): PaymentRow {
  const billingName = [tx.billing_address?.first_name, tx.billing_address?.last_name].filter(Boolean).join(" ");
  return {
    uid: tx.uid,
    createdAt: tx.created_at ?? undefined,
    paidAt: tx.paid_at ?? undefined,
    amount: fromMinorUnits(tx.amount),
    currency: tx.currency,
    description: tx.description ?? undefined,
    trackingId: tx.tracking_id ?? undefined,
    payerEmail: tx.customer?.email ?? undefined,
    payerName: billingName || tx.credit_card?.holder || undefined,
    cardLast4: tx.credit_card?.last_4 ?? undefined,
    paymentMethod: tx.payment_method_type ?? undefined,
    ...paymentOrigin(tx),
    issuerBank: tx.credit_card?.issuer_name ?? undefined,
    test: tx.test ?? false,
  };
}

interface Accumulator {
  report: GroupReport;
  groups: Map<string, Map<string, { payer: PayerPayments; minor: Map<string, number> }>>;
  grandTotals: Map<string, number>;
  originMinor: Map<string, Map<string, number>>; // "origin" or "foreign:<country>" -> currency sums
  foreignMinor: Map<string, Map<string, number>>; // group code -> currency sums
}

export function buildGroupReport(transactions: Transaction[], roster: Roster, onlyGroup?: string): GroupReport {
  const acc: Accumulator = {
    report: {
      groups: [],
      ambiguous: [],
      unmatched: [],
      otherPrograms: [],
      origins: { domestic: empty(), foreign: empty(), unknown: empty() },
      foreignByCountry: {},
      totals: {},
      transactionCount: 0,
    },
    groups: new Map(),
    grandTotals: new Map(),
    originMinor: new Map(),
    foreignMinor: new Map(),
  };
  for (const tx of transactions.filter(isIncomingPayment)) {
    const row = toPaymentRow(tx);
    if (place(acc, tx, row, matchTransaction(tx, roster), onlyGroup)) countTotals(acc, tx, row);
  }
  return finish(acc);
}

/** Puts the payment into the report section of its match; false when the group filter leaves it out. */
function place(acc: Accumulator, tx: Transaction, row: PaymentRow, match: MatchResult, onlyGroup?: string): boolean {
  const { report } = acc;
  switch (match.status) {
    case "matched":
      if (onlyGroup && match.payer.groupCode !== onlyGroup) return false;
      addPayerPayment(acc, tx, { ...row, matchedBy: match.by, resolvedBy: match.resolvedBy, meeting: match.meeting }, match.payer);
      return true;
    case "ambiguous":
      // When filtering by group, keep only ambiguous rows that could belong to it.
      if (onlyGroup && !match.candidates.some((c) => c.groupCode === onlyGroup)) return false;
      report.ambiguous.push({ ...row, matchedBy: match.by, candidates: summarize(match.candidates) });
      return true;
    case "other_program":
      if (onlyGroup) return false;
      report.otherPrograms.push(row);
      return true;
    default:
      if (onlyGroup) return false;
      report.unmatched.push({ ...row, note: match.reason });
      return true;
  }
}

function addPayerPayment(acc: Accumulator, tx: Transaction, row: PaymentRow, payer: Payer) {
  const payers = acc.groups.get(payer.groupCode) ?? new Map();
  acc.groups.set(payer.groupCode, payers);
  const entry = payers.get(payer.id) ?? {
    payer: { payerId: payer.id, name: payer.name, email: payer.email, payments: [], totals: {} },
    minor: new Map<string, number>(),
  };
  payers.set(payer.id, entry);
  entry.payer.payments.push(row);
  add(entry.minor, tx.currency, tx.amount);
  if (row.origin === "foreign") add(bucket(acc.foreignMinor, payer.groupCode), tx.currency, tx.amount);
}

function countTotals(acc: Accumulator, tx: Transaction, row: PaymentRow) {
  const { report } = acc;
  report.transactionCount++;
  add(acc.grandTotals, tx.currency, tx.amount);
  report.origins[row.origin].count++;
  add(bucket(acc.originMinor, row.origin), tx.currency, tx.amount);
  if (row.origin !== "foreign") return;
  const country = row.issuerCountry ?? "?";
  report.foreignByCountry[country] ??= empty();
  report.foreignByCountry[country].count++;
  add(bucket(acc.originMinor, `foreign:${country}`), tx.currency, tx.amount);
}

function finish(acc: Accumulator): GroupReport {
  const { report } = acc;
  for (const [groupCode, payers] of [...acc.groups].sort(([a], [b]) => a.localeCompare(b, "ru"))) {
    const groupMinor = new Map<string, number>();
    const list = [...payers.values()].map(({ payer, minor }) => {
      for (const [currency, amount] of minor) add(groupMinor, currency, amount);
      return { ...payer, totals: format(minor) };
    });
    list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    report.groups.push({
      groupCode,
      payers: list,
      totals: format(groupMinor),
      foreignTotals: format(acc.foreignMinor.get(groupCode) ?? new Map()),
      paymentCount: list.reduce((n, s) => n + s.payments.length, 0),
    });
  }
  report.totals = format(acc.grandTotals);
  for (const origin of Object.keys(report.origins) as PaymentOrigin[]) {
    report.origins[origin].totals = format(acc.originMinor.get(origin) ?? new Map());
  }
  for (const [country, summary] of Object.entries(report.foreignByCountry)) {
    summary.totals = format(acc.originMinor.get(`foreign:${country}`) ?? new Map());
  }
  return report;
}

function summarize(candidates: { id: string; name: string; groupCode: string }[]) {
  return candidates.map((c) => ({ payerId: c.id, name: c.name, groupCode: c.groupCode }));
}

function empty(): OriginSummary {
  return { count: 0, totals: {} };
}

function bucket(map: Map<string, Map<string, number>>, key: string): Map<string, number> {
  let inner = map.get(key);
  if (!inner) {
    inner = new Map();
    map.set(key, inner);
  }
  return inner;
}

function add(map: Map<string, number>, currency: string, amount: number) {
  map.set(currency, (map.get(currency) ?? 0) + amount);
}

function format(map: Map<string, number>): Record<string, string> {
  return Object.fromEntries([...map].map(([currency, minor]) => [currency, fromMinorUnits(minor)]));
}
