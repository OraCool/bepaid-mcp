import { BEPAID_HOSTS, BepaidClient } from "./client.js";
import { wallClockToUtc } from "./timeZone.js";
import {
  DATE_TYPES,
  PAYMENT_METHOD_TYPES,
  REPORT_STATUSES,
  type PaymentMethodType,
  reportPageSchema,
  type Transaction,
} from "./types.js";

export interface ReportQuery {
  from: string; // "YYYY-MM-DD hh:mm:ss" or "YYYY-MM-DD"
  to: string;
  dateType?: (typeof DATE_TYPES)[number];
  status?: (typeof REPORT_STATUSES)[number];
  paymentMethodTypes?: readonly PaymentMethodType[];
  timeZone: string;
}

// Safety net in case the API keeps returning has_more with the same cursor.
const MAX_PAGES_PER_METHOD = 500;

/**
 * Iterates all transactions of the paginated report (API v3).
 * payment_method_type is a required single value, so each method type is queried separately;
 * pages are followed via starting_after = last_object_id while has_more is true.
 */
export async function* iterateTransactions(
  client: BepaidClient,
  query: ReportQuery,
): AsyncGenerator<Transaction> {
  const seen = new Set<string>();
  for (const paymentMethodType of query.paymentMethodTypes ?? PAYMENT_METHOD_TYPES) {
    let startingAfter: string | number | undefined;
    for (let page = 0; page < MAX_PAGES_PER_METHOD; page++) {
      const raw = await client.request(BEPAID_HOSTS.reports, "/api/reports", {
        apiVersion: "3",
        body: {
          report_params: {
            date_type: query.dateType ?? "paid_at",
            from: withTime(query.from, "00:00:00"),
            to: withTime(query.to, "23:59:59"),
            status: query.status ?? "successful",
            payment_method_type: paymentMethodType,
            time_zone: query.timeZone,
            ...(startingAfter !== undefined && { starting_after: startingAfter }),
          },
        },
      });
      const result = reportPageSchema.parse(raw);
      for (const transaction of result.transactions) {
        if (seen.has(transaction.uid)) continue;
        seen.add(transaction.uid);
        yield toUtcTimestamps(transaction, query.timeZone);
      }
      const next = result.last_object_id ?? undefined;
      if (!result.has_more || next === undefined || next === startingAfter) break;
      startingAfter = next;
    }
  }
}

// Report timestamps are wall-clock times in the requested time_zone despite their "Z" suffix.
const TIMESTAMP_FIELDS = ["created_at", "paid_at", "updated_at", "manually_corrected_at"] as const;

function toUtcTimestamps(transaction: Transaction, timeZone: string): Transaction {
  const fixed: Record<string, unknown> = { ...transaction };
  for (const field of TIMESTAMP_FIELDS) {
    if (typeof fixed[field] === "string") fixed[field] = wallClockToUtc(fixed[field] as string, timeZone);
  }
  return fixed as Transaction;
}

export async function collectTransactions(client: BepaidClient, query: ReportQuery): Promise<Transaction[]> {
  const all: Transaction[] = [];
  for await (const transaction of iterateTransactions(client, query)) all.push(transaction);
  return all;
}

// "2026-01-31" -> "2026-01-31 23:59:59"; full timestamps are kept as is.
function withTime(date: string, time: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date.trim()) ? `${date.trim()} ${time}` : date.trim();
}
