import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { BepaidClient } from "../src/bepaid/client.js";
import { loadConfig } from "../src/config.js";
import { parseRosterWorkbook, type Roster } from "../src/roster/loadRoster.js";
import { createServer } from "../src/server.js";
import type { ToolContext } from "../src/tools/context.js";
import { buildRosterWorkbook } from "./fixtures/roster.js";

const roster = parseRosterWorkbook(buildRosterWorkbook(), { bepaidUrlMarkers: ["pay.example.by"] });

const reportTransactions = [
  {
    id: 1, uid: "u1", type: "payment", status: "successful", amount: 55000, currency: "BYN",
    transaction_fee: 1600, pay_to_merchant: 53400, description: "«Основы терапии»",
    payment_method_type: "credit_card", customer: { email: "olga@example.com" },
    credit_card: { holder: "OLGA PETROVA", issuer_country: "RU", issuer_name: "Demo Bank", brand: "visa", last_4: "1111" },
  },
  { id: 2, uid: "u2", type: "payment", status: "failed", amount: 55000, currency: "BYN", payment_method_type: "credit_card" },
];

let requests: { url: string; body: any }[];
const fetchImpl = (async (url: string, init: RequestInit) => {
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  requests.push({ url, body });
  const lookup = /\/v2\/transactions\/tracking_id\/(.+)$/.exec(url);
  if (lookup) {
    // Real gateway shape: a "transactions" array, id is the uid string.
    const id = "3e413c67-0000-0000-0000-000000000000";
    return new Response(JSON.stringify({ transactions: [{ id, uid: id, type: "payment", status: "successful", test: true, amount: 55000, currency: "BYN", tracking_id: decodeURIComponent(lookup[1]!) }] }));
  }
  if (url.endsWith("/ctp/api/checkouts")) {
    return new Response(JSON.stringify({ checkout: { token: "tok", redirect_url: "https://checkout.bepaid.by/v2/checkout?token=tok" } }));
  }
  const status = body?.report_params?.status;
  const transactions =
    body?.report_params?.payment_method_type === "credit_card"
      ? reportTransactions.filter((t) => status === "all" || t.status === status)
      : [];
  return new Response(JSON.stringify({ transactions, has_more: false }));
}) as unknown as typeof fetch;

async function connect(env: Record<string, string> = {}, rosterData: Roster | null = roster) {
  const config = loadConfig({ BEPAID_SHOP_ID: "1", BEPAID_SECRET_KEY: "s", ...env });
  const ctx: ToolContext = {
    config,
    client: new BepaidClient(config.credentials, fetchImpl),
    rosterEnabled: rosterData !== null,
    getRoster: async () => {
      if (!rosterData) throw new Error("no roster");
      return rosterData;
    },
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(ctx).connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]!.text;
  return { isError: result.isError === true, text, data: result.isError ? undefined : JSON.parse(text) };
}

const GENERIC_TOOLS = ["bepaid_create_payment_link", "bepaid_export_transactions", "bepaid_get_transaction", "bepaid_list_transactions"];

beforeEach(() => {
  requests = [];
});

describe("generic bePaid server (no roster)", () => {
  it("exposes only the generic tools", async () => {
    const client = await connect({}, null);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(GENERIC_TOOLS);
  });

  it("creates a payment link from plain parameters", async () => {
    const client = await connect({}, null);
    const { data } = await call(client, "bepaid_create_payment_link", {
      amount: "19.99",
      description: "Order 42",
      tracking_id: "order-42",
      require_customer_fields: ["email", "first_name"],
    });
    expect(data).toMatchObject({ test: true, amount: "19.99 BYN", tracking_id: "order-42" });
    expect(requests[0]!.body.checkout).toMatchObject({
      test: true,
      order: { amount: 1999, currency: "BYN", description: "Order 42", tracking_id: "order-42" },
      settings: { customer_fields: { visible: ["email", "first_name"] } },
    });
    expect(requests[0]!.body.checkout.customer).toBeUndefined();
  });

  it("refuses real links while test mode is on", async () => {
    const client = await connect({}, null);
    const result = await call(client, "bepaid_create_payment_link", { amount: "1", description: "x", test: false });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/BEPAID_TEST_MODE/);
    expect(requests).toHaveLength(0);
  });

  it("lists transactions with totals over successful payments", async () => {
    const client = await connect({}, null);
    const { data } = await call(client, "bepaid_list_transactions", { from: "2026-09-01", to: "2026-09-30", status: "all" });
    expect(data.total).toBe(2);
    expect(data.summary).toMatchObject({
      successfulPayments: 1,
      totals: { BYN: { amount: "550.00", fee: "16.00", payout: "534.00" } },
      byOrigin: { foreign: { BYN: "550.00" } },
      foreignByCountry: { RU: { BYN: "550.00" } },
    });
    expect(data.transactions[0].match).toBeUndefined();
  });

  it.each([
    ["ru", "UID транзакции", "Сводка"],
    ["en", "Transaction UID", "Summary"],
  ])("exports all transactions without roster (%s)", async (language, uidHeader, summarySheet) => {
    const dir = await mkdtemp(join(tmpdir(), "bepaid-tx-"));
    const client = await connect({ EXPORT_DIR: dir, EXPORT_LANGUAGE: language }, null);

    const xlsx = await call(client, "bepaid_export_transactions", { from: "2026-09-01", to: "2026-09-30" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsx.data.file);
    expect(wb.worksheets[0]!.name).toBe(summarySheet);
    const sheet = wb.worksheets[1]!;
    expect(sheet.getCell("A1").value).toBe(uidHeader);
    expect(sheet.rowCount).toBe(3); // header + successful + failed (status "all" by default)

    const csv = await call(client, "bepaid_export_transactions", { from: "2026-09-01", to: "2026-09-30", format: "csv", status: "successful" });
    const text = await readFile(csv.data.file, "utf8");
    expect(text.split("\n")).toHaveLength(2);
    expect(text).toContain("RU");
  });
});

describe("with roster module", () => {
  it("adds the roster tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        ...GENERIC_TOOLS,
        "roster_create_payment_link",
        "roster_export_group_report",
        "roster_find_payer",
        "roster_list_groups",
        "roster_payments_by_group",
      ].sort(),
    );
  });

  it("reports payments by group", async () => {
    const client = await connect();
    const { data } = await call(client, "roster_payments_by_group", { from: "2026-09-01", to: "2026-09-30" });
    expect(data.groups[0]).toMatchObject({ groupCode: "Альфа-25.1", totals: { BYN: "550.00" } });
    expect(requests[0]!.body.report_params.time_zone).toBe("Europe/Minsk");
  });

  it("creates a test payment link with tracking_id and prefilled email", async () => {
    const client = await connect();
    const { data } = await call(client, "roster_create_payment_link", {
      group: "альфа 25.1",
      payer: "Петрова",
      amount: "550",
      meeting: "3",
    });
    expect(data).toMatchObject({ test: true, group: "Альфа-25.1", tracking_id: expect.stringMatching(/^grp1\|alfa-25\.1\|03\|/) });
    expect(requests[0]!.body.checkout).toMatchObject({
      test: true,
      order: { amount: 55000, currency: "BYN", description: "Альфа-25.1, встреча 03" },
      customer: { email: "olga@example.com", first_name: "Olga", last_name: "Petrova" },
    });
    expect(requests[0]!.body.checkout.settings.customer_fields).toBeUndefined();
  });

  it("asks the payer for an email when the roster has none", async () => {
    const client = await connect();
    await call(client, "roster_create_payment_link", { group: "Бета 25", payer: "Сидорова", amount: "550" });
    expect(requests[0]!.body.checkout.settings.customer_fields).toEqual({ visible: ["email"] });
  });

  it("rejects a payer query that matches nobody", async () => {
    const client = await connect();
    const result = await call(client, "roster_create_payment_link", { group: "Альфа-25.1", payer: "Неизвестный Человек", amount: "550" });
    expect(result.isError).toBe(true);
  });

  it("takes the link amount from the module price", async () => {
    const withModules = parseRosterWorkbook(
      buildRosterWorkbook([
        ["Альфа-25.1", 1, "2026-09-10", 550, "BYN"],
        ["Альфа-25.1", 2, "2026-10-08", 600, "BYN"],
      ]),
    );
    const client = await connect({}, withModules);
    const { data } = await call(client, "roster_create_payment_link", { group: "Альфа-25.1", payer: "Петрова", meeting: "2" });
    expect(data.amount).toBe("600.00 BYN");
    expect(requests[0]!.body.checkout.order).toMatchObject({ amount: 60000, currency: "BYN" });

    const ambiguousPrice = await call(client, "roster_create_payment_link", { group: "Альфа-25.1", payer: "Петрова" });
    expect(ambiguousPrice.isError).toBe(true);
    expect(ambiguousPrice.text).toMatch(/several module prices/);
  });

  it("looks up a paid link by tracking_id and shows the exact match", async () => {
    const client = await connect();
    const link = await call(client, "roster_create_payment_link", { group: "Альфа-25.1", payer: "Петрова", amount: "550", meeting: "1" });
    const { data } = await call(client, "bepaid_get_transaction", { tracking_id: link.data.tracking_id });
    expect(data[0]).toMatchObject({
      test: true,
      amount: "550.00",
      match: { status: "matched", group: "Альфа-25.1", payer: "Ольга Петрова", by: "tracking_id", meeting: "01" },
    });
  });
});
