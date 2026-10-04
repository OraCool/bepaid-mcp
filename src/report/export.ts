import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import type { GroupReport, PaymentRow } from "./aggregate.js";
import { toCsv } from "./csv.js";

// Writes a new report file; existing business workbooks are never modified.

const PAYMENT_COLUMNS = [
  { header: "Группа", key: "group", width: 22 },
  { header: "Плательщик", key: "payer", width: 28 },
  { header: "Дата оплаты", key: "paidAt", width: 22 },
  { header: "Сумма", key: "amount", width: 12 },
  { header: "Валюта", key: "currency", width: 8 },
  { header: "Встреча", key: "meeting", width: 9 },
  { header: "Сопоставлено по", key: "matchedBy", width: 16 },
  { header: "Группа выбрана по", key: "resolvedBy", width: 16 },
  { header: "Имя в bePaid", key: "payerName", width: 24 },
  { header: "Email в bePaid", key: "payerEmail", width: 28 },
  { header: "Карта", key: "cardLast4", width: 8 },
  { header: "Способ оплаты", key: "paymentMethod", width: 13 },
  { header: "Страна банка", key: "issuerCountry", width: 8 },
  { header: "Банк", key: "issuerBank", width: 28 },
  { header: "Происхождение", key: "origin", width: 13 },
  { header: "Описание", key: "description", width: 30 },
  { header: "tracking_id", key: "trackingId", width: 30 },
  { header: "UID транзакции", key: "uid", width: 24 },
  { header: "Тест", key: "test", width: 6 },
  { header: "Кандидаты", key: "candidates", width: 50 },
  { header: "Примечание", key: "note", width: 40 },
] as const;

const ORIGIN_LABELS = { domestic: "BY", foreign: "иностранный", unknown: "неизвестно" } as const;

type FlatRow = Record<(typeof PAYMENT_COLUMNS)[number]["key"], string | number | boolean | undefined>;

export async function exportReport(
  report: GroupReport,
  options: { dir: string; format: "xlsx" | "csv"; from: string; to: string },
): Promise<string> {
  const dir = resolve(options.dir);
  await mkdir(dir, { recursive: true });
  const stamp = `${options.from.slice(0, 10)}_${options.to.slice(0, 10)}`;
  const file = join(dir, `bepaid-payments_${stamp}.${options.format}`);

  const matched = report.groups.flatMap((g) =>
    g.payers.flatMap((s) => s.payments.map((p) => flat(p, g.groupCode, s.name))),
  );
  const ambiguous = report.ambiguous.map((p) =>
    flat(p, "?", "", p.candidates.map((c) => `${c.groupCode}: ${c.name}`).join("; ")),
  );
  const unmatched = report.unmatched.map((p) => flat(p, "", ""));
  const otherPrograms = report.otherPrograms.map((p) => flat(p, "", ""));

  if (options.format === "csv") {
    const rows = [...matched, ...ambiguous, ...unmatched, ...otherPrograms];
    const lines = [PAYMENT_COLUMNS.map((c) => c.header), ...rows.map((r) => PAYMENT_COLUMNS.map((c) => r[c.key]))];
    await writeFile(file, toCsv(lines), "utf8");
    return file;
  }

  const wb = new ExcelJS.Workbook();
  const summary = wb.addWorksheet("Сводка");
  summary.columns = [
    { header: "Группа", key: "group", width: 24 },
    { header: "Плательщиков", key: "payers", width: 14 },
    { header: "Платежей", key: "count", width: 10 },
    { header: "Сумма", key: "totals", width: 30 },
  ];
  for (const g of report.groups) {
    summary.addRow({ group: g.groupCode, payers: g.payers.length, count: g.paymentCount, totals: totalsText(g.totals) });
  }
  summary.addRow({ group: "Неоднозначные", count: report.ambiguous.length });
  summary.addRow({ group: "Не сопоставлены", count: report.unmatched.length });
  summary.addRow({ group: "Другие программы", count: report.otherPrograms.length });
  summary.addRow({ group: "Итого", count: report.transactionCount, totals: totalsText(report.totals) });
  summary.addRow({});
  summary.addRow({ group: "Происхождение платежей (банк-эмитент)" }).font = { bold: true };
  summary.addRow({ group: "Беларусь", count: report.origins.domestic.count, totals: totalsText(report.origins.domestic.totals) });
  summary.addRow({ group: "Иностранные", count: report.origins.foreign.count, totals: totalsText(report.origins.foreign.totals) });
  for (const [country, s] of Object.entries(report.foreignByCountry).sort(([a], [b]) => a.localeCompare(b))) {
    summary.addRow({ group: `  ${country}`, count: s.count, totals: totalsText(s.totals) });
  }
  summary.addRow({ group: "Неизвестно", count: report.origins.unknown.count, totals: totalsText(report.origins.unknown.totals) });
  summary.getRow(1).font = { bold: true };

  addSheet(wb, "Платежи", matched);
  addSheet(wb, "Неоднозначные", ambiguous);
  addSheet(wb, "Не сопоставлены", unmatched);
  addSheet(wb, "Другие программы", otherPrograms);
  addSheet(wb, "Иностранные платежи", [...matched, ...ambiguous, ...unmatched, ...otherPrograms].filter((r) => r.origin === ORIGIN_LABELS.foreign));
  await wb.xlsx.writeFile(file);
  return file;
}

function addSheet(wb: ExcelJS.Workbook, name: string, rows: FlatRow[]) {
  const sheet = wb.addWorksheet(name);
  sheet.columns = PAYMENT_COLUMNS.map((c) => ({ ...c }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function flat(p: PaymentRow, group: string, payer: string, candidates?: string): FlatRow {
  return {
    group,
    payer,
    paidAt: p.paidAt,
    amount: Number(p.amount),
    currency: p.currency,
    meeting: p.meeting,
    matchedBy: p.matchedBy,
    resolvedBy: p.resolvedBy,
    payerName: p.payerName,
    payerEmail: p.payerEmail,
    cardLast4: p.cardLast4,
    paymentMethod: p.paymentMethod,
    issuerCountry: p.issuerCountry,
    issuerBank: p.issuerBank,
    origin: ORIGIN_LABELS[p.origin],
    description: p.description,
    trackingId: p.trackingId,
    uid: p.uid,
    test: p.test,
    candidates,
    note: p.note,
  };
}

function totalsText(totals: Record<string, string>): string {
  return Object.entries(totals)
    .map(([currency, amount]) => `${amount} ${currency}`)
    .join(", ");
}

