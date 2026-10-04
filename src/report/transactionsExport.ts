import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import type { Transaction } from "../bepaid/types.js";
import { fromMinorUnits } from "../money.js";
import { toCsv } from "./csv.js";
import { paymentOrigin } from "./origin.js";

// General transaction export: every transaction as returned by bePaid, no roster involved.

export type ExportLanguage = "ru" | "en";

const COLUMNS = [
  "uid", "createdAt", "paidAt", "settledAt", "type", "status", "amount", "fee", "payout", "currency",
  "description", "trackingId", "orderId", "paymentMethod", "payerEmail", "payerName", "payerPhone",
  "cardBrand", "cardLast4", "issuerCountry", "issuerBank", "origin", "test",
] as const;
type Column = (typeof COLUMNS)[number];
type Row = Record<Column, string | number | boolean | undefined>;

const LABELS: Record<ExportLanguage, Record<Column | SummaryLabel | SheetLabel, string>> = {
  ru: {
    uid: "UID транзакции", createdAt: "Создана", paidAt: "Оплачена", settledAt: "Дата расчёта", type: "Тип",
    status: "Статус", amount: "Сумма", fee: "Комиссия", payout: "К выплате", currency: "Валюта",
    description: "Описание", trackingId: "tracking_id", orderId: "order_id", paymentMethod: "Способ оплаты",
    payerEmail: "Email плательщика", payerName: "Плательщик", payerPhone: "Телефон", cardBrand: "Карта",
    cardLast4: "Последние 4 цифры", issuerCountry: "Страна банка", issuerBank: "Банк", origin: "Происхождение",
    test: "Тест",
    summary: "Сводка", transactions: "Транзакции", period: "Период", successfulPayments: "Успешные платежи",
    byCurrency: "По валютам", byDescription: "По описанию", byOrigin: "По происхождению (банк-эмитент)",
    byCountry: "Иностранные по странам", byMethod: "По способу оплаты", count: "Количество", total: "Сумма",
    totalFee: "Комиссия", totalPayout: "К выплате", domestic: "Внутренние", foreign: "Иностранные", unknown: "Неизвестно",
    allTransactions: "Все транзакции в выгрузке",
  },
  en: {
    uid: "Transaction UID", createdAt: "Created", paidAt: "Paid", settledAt: "Settled", type: "Type",
    status: "Status", amount: "Amount", fee: "Fee", payout: "Payout", currency: "Currency",
    description: "Description", trackingId: "tracking_id", orderId: "order_id", paymentMethod: "Payment method",
    payerEmail: "Payer email", payerName: "Payer", payerPhone: "Phone", cardBrand: "Card",
    cardLast4: "Last 4 digits", issuerCountry: "Issuer country", issuerBank: "Issuer bank", origin: "Origin",
    test: "Test",
    summary: "Summary", transactions: "Transactions", period: "Period", successfulPayments: "Successful payments",
    byCurrency: "By currency", byDescription: "By description", byOrigin: "By origin (card-issuing bank)",
    byCountry: "Foreign by country", byMethod: "By payment method", count: "Count", total: "Amount",
    totalFee: "Fee", totalPayout: "Payout", domestic: "Domestic", foreign: "Foreign", unknown: "Unknown",
    allTransactions: "All transactions in export",
  },
};
type SheetLabel = "summary" | "transactions";
type SummaryLabel =
  | "period" | "successfulPayments" | "byCurrency" | "byDescription" | "byOrigin" | "byCountry" | "byMethod"
  | "count" | "total" | "totalFee" | "totalPayout" | "domestic" | "foreign" | "unknown" | "allTransactions";

export interface TransactionsSummary {
  transactions: number;
  successfulPayments: number;
  totals: Record<string, { amount: string; fee: string; payout: string }>; // per currency
  byOrigin: Record<"domestic" | "foreign" | "unknown", Record<string, string>>; // origin -> currency -> amount
  foreignByCountry: Record<string, Record<string, string>>;
  byDescription: Record<string, Record<string, string>>;
  byPaymentMethod: Record<string, Record<string, string>>;
}

/** Totals over successful payments (refunds, failed and pending transactions are listed but not summed). */
export function summarizeTransactions(transactions: Transaction[]): TransactionsSummary {
  const payments = transactions.filter((tx) => (tx.type ?? "payment") === "payment" && tx.status === "successful");
  const sums = new Map<string, number>();
  const add = (key: string, amount: number) => sums.set(key, (sums.get(key) ?? 0) + amount);
  for (const tx of payments) {
    const c = tx.currency;
    const { origin, issuerCountry } = paymentOrigin(tx);
    add(`total|${c}`, tx.amount);
    add(`fee|${c}`, tx.transaction_fee ?? 0);
    add(`payout|${c}`, tx.pay_to_merchant ?? tx.amount - (tx.transaction_fee ?? 0));
    add(`origin|${origin}|${c}`, tx.amount);
    if (origin === "foreign") add(`country|${issuerCountry}|${c}`, tx.amount);
    add(`desc|${tx.description ?? ""}|${c}`, tx.amount);
    add(`method|${tx.payment_method_type ?? ""}|${c}`, tx.amount);
  }
  const group = (prefix: string) => {
    const out: Record<string, Record<string, string>> = {};
    for (const [key, minor] of sums) {
      const parts = key.split("|");
      if (parts[0] !== prefix) continue;
      const perCurrency = (out[parts[1]!] ??= {});
      perCurrency[parts[2]!] = fromMinorUnits(minor);
    }
    return out;
  };
  const currencies = [...new Set(payments.map((tx) => tx.currency))];
  const origin = group("origin");
  return {
    transactions: transactions.length,
    successfulPayments: payments.length,
    totals: Object.fromEntries(
      currencies.map((c) => [
        c,
        {
          amount: fromMinorUnits(sums.get(`total|${c}`) ?? 0),
          fee: fromMinorUnits(sums.get(`fee|${c}`) ?? 0),
          payout: fromMinorUnits(sums.get(`payout|${c}`) ?? 0),
        },
      ]),
    ),
    byOrigin: { domestic: origin.domestic ?? {}, foreign: origin.foreign ?? {}, unknown: origin.unknown ?? {} },
    foreignByCountry: group("country"),
    byDescription: group("desc"),
    byPaymentMethod: group("method"),
  };
}

export function transactionRow(tx: Transaction): Row {
  const billing = [tx.billing_address?.first_name, tx.billing_address?.last_name].filter(Boolean).join(" ");
  const { origin, issuerCountry } = paymentOrigin(tx);
  const minor = (value: number | null | undefined) => (value === null || value === undefined ? undefined : Number(fromMinorUnits(value)));
  return {
    uid: tx.uid,
    createdAt: tx.created_at ?? undefined,
    paidAt: tx.paid_at ?? undefined,
    settledAt: tx.settled_at ?? undefined,
    type: tx.type,
    status: tx.status,
    amount: minor(tx.amount),
    fee: minor(tx.transaction_fee),
    payout: minor(tx.pay_to_merchant),
    currency: tx.currency,
    description: tx.description ?? undefined,
    trackingId: tx.tracking_id ?? undefined,
    orderId: tx.order_id ?? undefined,
    paymentMethod: tx.payment_method_type ?? undefined,
    payerEmail: tx.customer?.email ?? undefined,
    payerName: billing || tx.credit_card?.holder || undefined,
    payerPhone: tx.billing_address?.phone ?? undefined,
    cardBrand: tx.credit_card?.brand ?? undefined,
    cardLast4: tx.credit_card?.last_4 ?? undefined,
    issuerCountry,
    issuerBank: tx.credit_card?.issuer_name ?? undefined,
    origin,
    test: tx.test ?? false,
  };
}

export async function exportTransactions(
  transactions: Transaction[],
  options: { dir: string; format: "xlsx" | "csv"; from: string; to: string; language: ExportLanguage },
): Promise<string> {
  const L = LABELS[options.language];
  const dir = resolve(options.dir);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `bepaid-transactions_${options.from.slice(0, 10)}_${options.to.slice(0, 10)}.${options.format}`);
  const rows = transactions.map(transactionRow);

  if (options.format === "csv") {
    await writeFile(file, toCsv([COLUMNS.map((c) => L[c]), ...rows.map((r) => COLUMNS.map((c) => r[c]))]), "utf8");
  } else {
    await writeWorkbook(file, transactions, rows, options, L);
  }
  return file;
}

async function writeWorkbook(
  file: string,
  transactions: Transaction[],
  rows: Row[],
  options: { from: string; to: string },
  L: Record<Column | SummaryLabel | SheetLabel, string>,
) {
  const wb = new ExcelJS.Workbook();
  writeSummarySheet(wb.addWorksheet(L.summary), summarizeTransactions(transactions), options, L);
  const sheet = wb.addWorksheet(L.transactions);
  sheet.columns = COLUMNS.map((c) => ({ header: L[c], key: c, width: Math.max(10, L[c].length + 2) }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  await wb.xlsx.writeFile(file);
}

function writeSummarySheet(
  sheet: ExcelJS.Worksheet,
  summary: TransactionsSummary,
  options: { from: string; to: string },
  L: Record<string, string>,
) {
  sheet.columns = [{ width: 40 }, { width: 12 }, { width: 16 }, { width: 14 }, { width: 14 }];
  const heading = (text: string) => (sheet.addRow([text]).font = { bold: true });
  sheet.addRow([L.period, `${options.from} — ${options.to}`]);
  sheet.addRow([L.allTransactions, summary.transactions]);
  sheet.addRow([L.successfulPayments, summary.successfulPayments]);
  sheet.addRow([]);
  heading(L.byCurrency!);
  sheet.addRow(["", L.currency, L.total, L.totalFee, L.totalPayout]);
  for (const [currency, t] of Object.entries(summary.totals)) {
    sheet.addRow(["", currency, Number(t.amount), Number(t.fee), Number(t.payout)]);
  }
  const section = (title: string, data: Record<string, Record<string, string>>, label = (k: string) => k) => {
    sheet.addRow([]);
    heading(title);
    for (const [key, perCurrency] of Object.entries(data)) {
      for (const [currency, amount] of Object.entries(perCurrency)) sheet.addRow([label(key) || "—", currency, Number(amount)]);
    }
  };
  section(L.byOrigin!, summary.byOrigin, (k) => L[k] ?? k);
  section(L.byCountry!, summary.foreignByCountry);
  section(L.byMethod!, summary.byPaymentMethod);
  section(L.byDescription!, summary.byDescription);
}

