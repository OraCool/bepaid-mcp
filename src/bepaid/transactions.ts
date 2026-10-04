import { z } from "zod";
import { BEPAID_HOSTS, BepaidClient } from "./client.js";
import { iterateTransactions } from "./reports.js";
import { type Transaction, transactionSchema } from "./types.js";

const singleSchema = z.looseObject({ transaction: transactionSchema });
// tracking_id lookup returns an array (last 10) when the id is not unique.
const byTrackingSchema = z.union([
  singleSchema,
  z.looseObject({ transactions: z.array(transactionSchema) }),
  z.array(singleSchema),
]);

export async function getTransactionByUid(client: BepaidClient, uid: string): Promise<Transaction> {
  const raw = await client.request(BEPAID_HOSTS.gateway, `/transactions/${encodeURIComponent(uid)}`);
  return singleSchema.parse(raw).transaction;
}

export async function getTransactionsByTrackingId(client: BepaidClient, trackingId: string): Promise<Transaction[]> {
  const raw = await client.request(
    BEPAID_HOSTS.gateway,
    `/v2/transactions/tracking_id/${encodeURIComponent(trackingId)}`,
  );
  const parsed = byTrackingSchema.parse(raw);
  if (Array.isArray(parsed)) return parsed.map((item) => item.transaction);
  const list = z.array(transactionSchema).safeParse(parsed.transactions);
  return list.success ? list.data : [singleSchema.parse(parsed).transaction];
}

/**
 * Finds a transaction by its order_id, the number shown in back-office URLs (/merchant/orders/<order_id>).
 * The gateway has no lookup by order_id, so reports of the period are searched (newest dates are not
 * prioritised; keep the period short). Returns the live transaction from the gateway, or undefined.
 */
export async function findTransactionByOrderId(
  client: BepaidClient,
  orderId: string,
  period: { from: string; to: string; timeZone: string },
): Promise<Transaction | undefined> {
  for await (const tx of iterateTransactions(client, { ...period, dateType: "created_at", status: "all" })) {
    if (String(tx.order_id) === orderId) return getTransactionByUid(client, tx.uid);
  }
  return undefined;
}
