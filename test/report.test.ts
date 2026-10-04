import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { Transaction } from "../src/bepaid/types.js";
import { matchTransaction } from "../src/matching/match.js";
import { encodeTrackingId } from "../src/matching/trackingId.js";
import { buildGroupReport } from "../src/report/aggregate.js";
import { exportReport } from "../src/report/export.js";
import { parseRosterWorkbook } from "../src/roster/loadRoster.js";
import { buildRosterWorkbook } from "./fixtures/roster.js";

const roster = parseRosterWorkbook(buildRosterWorkbook(), { bepaidUrlMarkers: ["pay.example.by"] });
let seq = 0;
const tx = (extra: Partial<Transaction> = {}): Transaction => ({
  uid: `uid-${++seq}`,
  type: "payment",
  status: "successful",
  amount: 55000,
  currency: "BYN",
  paid_at: "2026-09-01T10:00:00Z",
  ...extra,
});

describe("matchTransaction", () => {
  const olga = roster.payers.find((s) => s.name === "Ольга Петрова")!;
  const maria = roster.payers.find((s) => s.name === "Мария Сидорова")!;

  it("prefers tracking_id from our own links", () => {
    const id = encodeTrackingId({ groupSlug: "alfa-25.1", meeting: "4", payerKey: olga.key! });
    expect(matchTransaction(tx({ tracking_id: id }), roster)).toMatchObject({
      status: "matched",
      by: "tracking_id",
      meeting: "04",
      payer: { name: "Ольга Петрова" },
    });
  });

  it("matches by email case-insensitively", () => {
    const result = matchTransaction(tx({ customer: { email: "OLGA@example.com" } }), roster);
    expect(result).toMatchObject({ status: "matched", by: "email", payer: { id: olga.id } });
  });

  it("matches by phone suffix", () => {
    const result = matchTransaction(tx({ billing_address: { phone: "+375447654321" } }), roster);
    expect(result).toMatchObject({ status: "matched", by: "phone", payer: { id: maria.id } });
  });

  it("matches by Latin card holder name in any order", () => {
    const result = matchTransaction(tx({ credit_card: { holder: "SIDOROVA MARIA" } }), roster);
    expect(result).toMatchObject({ status: "matched", by: "name", payer: { id: maria.id } });
  });

  it("does not match on a single name token", () => {
    expect(matchTransaction(tx({ credit_card: { holder: "MARIA" } }), roster).status).toBe("unmatched");
  });

  it("flags a person enrolled in several groups as ambiguous", () => {
    const result = matchTransaction(tx({ customer: { email: "anna.ivanova@mail.ru" } }), roster);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") expect(result.candidates.map((c) => c.groupCode).sort()).toEqual(["Бета 25", "Альфа-25.1"].sort());
  });
});

describe("buildGroupReport + export", () => {
  const transactions = [
    tx({ customer: { email: "olga@example.com" } }),
    tx({ customer: { email: "olga@example.com" }, amount: 1050 }),
    tx({ billing_address: { phone: "375447654321" } }),
    tx({ customer: { email: "anna.ivanova@mail.ru" } }), // ambiguous
    tx({ customer: { email: "stranger@x.by" }, description: "=HYPERLINK(\"evil\")" }), // unmatched
    tx({ type: "refund", customer: { email: "olga@example.com" } }), // excluded
    tx({ status: "failed", customer: { email: "olga@example.com" } }), // excluded
  ];

  it("groups payments per group and payer with exact totals", () => {
    const report = buildGroupReport(transactions, roster);
    expect(report.transactionCount).toBe(5);
    expect(report.totals).toEqual({ BYN: "2210.50" });
    const alpha = report.groups.find((g) => g.groupCode === "Альфа-25.1")!;
    expect(alpha.totals).toEqual({ BYN: "560.50" });
    expect(alpha.payers[0]).toMatchObject({ name: "Ольга Петрова", totals: { BYN: "560.50" } });
    expect(report.ambiguous).toHaveLength(1);
    expect(report.unmatched).toHaveLength(1);
  });

  it("filters by group but keeps ambiguous candidates of that group", () => {
    const report = buildGroupReport(transactions, roster, "Бета 25");
    expect(report.groups.map((g) => g.groupCode)).toEqual(["Бета 25"]);
    expect(report.ambiguous).toHaveLength(1);
    expect(report.unmatched).toHaveLength(0);
  });

  it("exports xlsx and formula-safe csv", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bepaid-export-"));
    const report = buildGroupReport(transactions, roster);
    const range = { from: "2026-09-01", to: "2026-09-30" };

    const xlsx = await exportReport(report, { dir, format: "xlsx", ...range });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsx);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Сводка", "Платежи", "Неоднозначные", "Не сопоставлены", "Другие программы", "Иностранные платежи"]);
    expect(wb.getWorksheet("Платежи")!.rowCount).toBe(4); // header + 3 matched

    const csv = await readFile(await exportReport(report, { dir, format: "csv", ...range }), "utf8");
    expect(csv.startsWith("﻿Группа,")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""evil"")"`);
  });
});
