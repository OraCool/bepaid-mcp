import { describe, expect, it } from "vitest";
import { BepaidClient, BepaidError } from "../src/bepaid/client.js";
import { createCheckout } from "../src/bepaid/checkout.js";
import { collectTransactions } from "../src/bepaid/reports.js";
import { getTransactionsByTrackingId } from "../src/bepaid/transactions.js";

interface Call {
  url: string;
  init: RequestInit;
  body: any;
}

function mockFetch(responder: (call: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const call = { url, init, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const { status = 200, json } = responder(call);
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const tx = (id: number, extra: object = {}) => ({
  id,
  uid: `uid-${id}`,
  type: "payment",
  status: "successful",
  amount: 55000,
  currency: "BYN",
  ...extra,
});

describe("reports", () => {
  it("pages with starting_after and queries every payment method type", async () => {
    const { impl, calls } = mockFetch(({ body }) => {
      const p = body.report_params;
      if (p.payment_method_type !== "credit_card") return { json: { transactions: [], has_more: false } };
      if (p.starting_after === undefined)
        return { json: { transactions: [tx(1), tx(2)], has_more: true, last_object_id: 2 } };
      return { json: { transactions: [tx(2), tx(3)], has_more: false, last_object_id: 3 } };
    });
    const client = new BepaidClient({ shopId: "1", secretKey: "s" }, impl);

    const result = await collectTransactions(client, { from: "2026-01-01", to: "2026-01-31", timeZone: "Europe/Minsk" });

    expect(result.map((t) => t.uid)).toEqual(["uid-1", "uid-2", "uid-3"]); // deduped
    expect(calls.map((c) => c.body.report_params.payment_method_type)).toEqual([
      "credit_card",
      "credit_card",
      "alternative",
      "erip",
    ]);
    expect(calls[1]!.body.report_params.starting_after).toBe(2);
    expect(calls[0]!.body.report_params.from).toBe("2026-01-01 00:00:00");
    expect(calls[0]!.body.report_params.to).toBe("2026-01-31 23:59:59");
    expect(calls[0]!.url).toBe("https://merchant.bepaid.by/api/reports");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["X-Api-Version"]).toBe("3");
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("1:s").toString("base64")}`);
  });
});

describe("errors", () => {
  it("maps 422 validation errors", async () => {
    const { impl } = mockFetch(() => ({
      status: 422,
      json: { message: "Validation failed", errors: { amount: ["must be greater than 0"] } },
    }));
    const client = new BepaidClient({ shopId: "1", secretKey: "s" }, impl);
    const promise = getTransactionsByTrackingId(client, "x");
    await expect(promise).rejects.toBeInstanceOf(BepaidError);
    await expect(promise).rejects.toThrow(/Validation failed.*amount/);
  });

  it("fails clearly without credentials", async () => {
    const client = new BepaidClient(undefined);
    await expect(getTransactionsByTrackingId(client, "x")).rejects.toThrow(/BEPAID_SHOP_ID/);
  });
});

describe("tracking id lookup", () => {
  it("accepts single and array responses", async () => {
    let shape: "single" | "array" = "single";
    const { impl, calls } = mockFetch(() =>
      shape === "single" ? { json: { transaction: tx(1) } } : { json: [{ transaction: tx(1) }, { transaction: tx(2) }] },
    );
    const client = new BepaidClient({ shopId: "1", secretKey: "s" }, impl);
    expect(await getTransactionsByTrackingId(client, "grp1|a|01|b")).toHaveLength(1);
    shape = "array";
    expect(await getTransactionsByTrackingId(client, "grp1|a|01|b")).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://gateway.bepaid.by/v2/transactions/tracking_id/grp1%7Ca%7C01%7Cb");
  });
});

describe("checkout", () => {
  it("builds the checkout token request", async () => {
    const { impl, calls } = mockFetch(() => ({
      json: { checkout: { token: "tok", redirect_url: "https://checkout.bepaid.by/v2/checkout?token=tok" } },
    }));
    const client = new BepaidClient({ shopId: "1", secretKey: "s" }, impl);
    const link = await createCheckout(client, {
      amountMinor: 55000,
      currency: "BYN",
      description: "Альфа 25.1, встреча 03",
      trackingId: "grp1|alfa-25.1|03|abcd1234",
      expiresAt: new Date("2026-10-10T00:00:00Z"),
      test: true,
      customer: { email: "a@b.by" },
    });
    expect(link.redirectUrl).toContain("token=tok");
    expect(calls[0]!.url).toBe("https://checkout.bepaid.by/ctp/api/checkouts");
    expect(calls[0]!.body.checkout).toMatchObject({
      transaction_type: "payment",
      test: true,
      order: { amount: 55000, currency: "BYN", tracking_id: "grp1|alfa-25.1|03|abcd1234", expired_at: "2026-10-10T00:00:00.000Z" },
      customer: { email: "a@b.by" },
    });
    expect((calls[0]!.init.headers as Record<string, string>)["X-Api-Version"]).toBe("2");
  });
});
