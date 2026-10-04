import { describe, expect, it } from "vitest";
import { BepaidClient } from "../src/bepaid/client.js";
import { collectTransactions } from "../src/bepaid/reports.js";
import { findTransactionByOrderId } from "../src/bepaid/transactions.js";
import { wallClockToUtc } from "../src/bepaid/timeZone.js";
import { toPaymentRow } from "../src/report/aggregate.js";

describe("wallClockToUtc", () => {
  it("turns report wall-clock values back into UTC", () => {
    expect(wallClockToUtc("2026-10-04T23:43:17Z", "Europe/Minsk")).toBe("2026-10-04T20:43:17.000Z");
    expect(wallClockToUtc("2026-10-05T05:43:17Z", "Asia/Tokyo")).toBe("2026-10-04T20:43:17.000Z");
    expect(wallClockToUtc("2026-10-04T20:43:17Z", "UTC")).toBe("2026-10-04T20:43:17.000Z");
  });

  it("follows daylight saving time", () => {
    expect(wallClockToUtc("2026-07-01T12:00:00Z", "Europe/Warsaw")).toBe("2026-07-01T10:00:00.000Z"); // UTC+2
    expect(wallClockToUtc("2026-01-15T12:00:00Z", "Europe/Warsaw")).toBe("2026-01-15T11:00:00.000Z"); // UTC+1
  });

  it("leaves dates without time and empty values alone", () => {
    expect(wallClockToUtc("2026-09-02", "Europe/Minsk")).toBe("2026-09-02");
    expect(wallClockToUtc(null, "Europe/Minsk")).toBeNull();
    expect(wallClockToUtc(undefined, "Europe/Minsk")).toBeUndefined();
  });
});

const reportTx = {
  id: 1023328724,
  uid: "tx-1",
  order_id: 900000001,
  type: "payment",
  status: "incomplete",
  amount: 54500,
  currency: "BYN",
  created_at: "2026-10-04T23:43:17Z", // Minsk wall clock, as the report API returns it
  paid_at: null,
  settled_at: "2026-10-05",
};

function fakeFetch(calls: string[]) {
  return (async (url: string) => {
    calls.push(url);
    if (url.includes("/api/reports")) return new Response(JSON.stringify({ transactions: [reportTx], has_more: false }));
    // Gateway: real UTC, plus response code/message.
    return new Response(
      JSON.stringify({
        transaction: { ...reportTx, created_at: "2026-10-04T20:43:17.518Z", code: "P.4012", friendly_message: "Redirect to pass 3-D Secure verification." },
      }),
    );
  }) as unknown as typeof fetch;
}

describe("reports", () => {
  it("return UTC timestamps regardless of the report time zone", async () => {
    const client = new BepaidClient({ shopId: "1", secretKey: "s" }, fakeFetch([]));
    const [tx] = await collectTransactions(client, { from: "2026-10-04", to: "2026-10-04", timeZone: "Europe/Minsk", paymentMethodTypes: ["credit_card"] });
    expect(tx!.created_at).toBe("2026-10-04T20:43:17.000Z");
    expect(tx!.paid_at).toBeNull();
    expect(tx!.settled_at).toBe("2026-10-05");
  });
});

describe("unpaid transactions", () => {
  it("have no payment date", () => {
    const row = toPaymentRow({ ...reportTx, created_at: "2026-10-04T20:43:17Z" });
    expect(row.paidAt).toBeUndefined();
    expect(row.createdAt).toBe("2026-10-04T20:43:17Z");
  });
});

describe("findTransactionByOrderId", () => {
  it("searches reports by order_id and returns the live gateway transaction", async () => {
    const calls: string[] = [];
    const client = new BepaidClient({ shopId: "1", secretKey: "s" }, fakeFetch(calls));
    const tx = await findTransactionByOrderId(client, "900000001", { from: "2026-10-01", to: "2026-10-05", timeZone: "Europe/Minsk" });
    expect(tx).toMatchObject({ uid: "tx-1", code: "P.4012", created_at: "2026-10-04T20:43:17.518Z" });
    expect(calls.at(-1)).toBe("https://gateway.bepaid.by/transactions/tx-1");
  });

  it("returns undefined when no transaction has that order_id", async () => {
    const client = new BepaidClient({ shopId: "1", secretKey: "s" }, fakeFetch([]));
    expect(await findTransactionByOrderId(client, "123", { from: "2026-10-01", to: "2026-10-05", timeZone: "UTC" })).toBeUndefined();
  });
});
