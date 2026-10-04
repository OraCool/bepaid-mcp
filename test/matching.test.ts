import { describe, expect, it } from "vitest";
import type { Transaction } from "../src/bepaid/types.js";
import { matchTransaction } from "../src/matching/match.js";
import { nameTokens, similarNameTokens } from "../src/matching/normalize.js";
import { buildGroupReport } from "../src/report/aggregate.js";
import { paymentOrigin } from "../src/report/origin.js";
import { parseRosterWorkbook } from "../src/roster/loadRoster.js";
import { buildRosterWorkbook, type RosterExtras } from "./fixtures/roster.js";

const roster = (extras: RosterExtras = {}) => parseRosterWorkbook(buildRosterWorkbook(undefined, extras));
let seq = 0;
const tx = (extra: Partial<Transaction> = {}): Transaction => ({
  uid: `uid-${++seq}`,
  type: "payment",
  status: "successful",
  amount: 55000,
  currency: "BYN",
  paid_at: "2026-09-01T10:00:00Z",
  payment_method_type: "credit_card",
  ...extra,
});
const token = (name: string) => [...nameTokens(name)][0]!;
const summary = (r: ReturnType<typeof matchTransaction>) =>
  r.status === "matched" ? `${r.by}:${r.payer.groupCode}:${r.payer.name}` : r.status;

describe("Belarusian passport spellings", () => {
  it.each([
    ["Volha", "Ольга"],
    ["Iryna", "Ирина"],
    ["Aliaksandra", "Александра"],
    ["Katsiaryna", "Екатерина"],
    ["Tatsiana", "Татьяна"],
    ["Hleb", "Глеб"],
    ["Yauheni", "Евгений"],
    ["Dzmitry", "Дмитрий"],
    ["Uladzimir", "Владимир"],
    ["Hanna", "Анна"],
    ["Alena", "Елена"],
    ["Maryia", "Мария"],
    ["Kavaleuskaya", "Ковалевская"],
  ])("%s = %s", (latin, cyrillic) => {
    expect(similarNameTokens(token(latin), token(cyrillic))).toBe(true);
  });

  it.each([
    ["Alina", "Елена"],
    ["Olga", "Алла"],
    ["Anna", "Инна"],
    ["Petrova", "Сидорова"],
  ])("%s ≠ %s", (latin, cyrillic) => {
    expect(similarNameTokens(token(latin), token(cyrillic))).toBe(false);
  });

  it("matches a card holder by Belarusian spelling, marked as fuzzy", () => {
    expect(summary(matchTransaction(tx({ credit_card: { holder: "VOLHA PIATROVA" } }), roster()))).toBe(
      "name_fuzzy:Альфа-25.1:Ольга Петрова",
    );
    // An exact spelling is still preferred and reported as "name".
    expect(summary(matchTransaction(tx({ credit_card: { holder: "OLGA PETROVA" } }), roster()))).toBe(
      "name:Альфа-25.1:Ольга Петрова",
    );
  });

  it("requires both first and last name to fit", () => {
    expect(summary(matchTransaction(tx({ credit_card: { holder: "VOLHA SIDARAVA" } }), roster()))).toBe("unmatched");
  });
});

describe("program of the payment", () => {
  it("limits candidates to groups of the program", () => {
    // Анна Иванова studies in both groups; the description decides without price/date data.
    const r = roster({ programs: { "Альфа-25.1": "«Основы терапии»", "Бета 25": "Сновидения" } });
    const payment = tx({ description: "«Основы  терапии»", customer: { email: "anna.ivanova@mail.ru" } });
    expect(summary(matchTransaction(payment, r))).toBe("email:Альфа-25.1:Анна Иванова");
  });

  it("reports programs without a group separately", () => {
    const r = roster({ programs: { "Альфа-25.1": "Основы терапии", "Бета 25": "Сновидения" } });
    const payment = tx({ description: "«Индивидуальная консультация»", customer: { email: "olga@example.com" } });
    expect(matchTransaction(payment, r)).toEqual({ status: "other_program", program: "«Индивидуальная консультация»" });
  });

  it("keeps groups without a program value as candidates", () => {
    const r = roster({ programs: { "Альфа-25.1": "Основы терапии" } });
    const payment = tx({ description: "«Индивидуальная консультация»", customer: { email: "anna.ivanova@mail.ru" } });
    expect(summary(matchTransaction(payment, r))).toBe("email:Бета 25:Анна Иванова");
  });
});

describe("manual assignments", () => {
  const r = roster({
    manualRows: [
      ["erip-1", "Бета 25", "Мария Сидорова", 3],
      ["erip-2", "Бета 25", "Неизвестная", null],
      ["erip-3", "Гамма", "Мария Сидорова", null],
    ],
  });

  it("wins over automatic matching", () => {
    const result = matchTransaction(tx({ uid: "erip-1", payment_method_type: "erip", customer: { email: "olga@example.com" } }), r);
    expect(result).toMatchObject({ status: "matched", by: "manual", meeting: "03", payer: { name: "Мария Сидорова" } });
  });

  it("explains rows that cannot be applied", () => {
    expect(matchTransaction(tx({ uid: "erip-2" }), r)).toMatchObject({ status: "unmatched", reason: expect.stringMatching(/row 3/) });
    expect(matchTransaction(tx({ uid: "erip-3" }), r)).toMatchObject({ status: "unmatched", reason: expect.stringMatching(/unknown group/) });
  });
});

describe("payment origin", () => {
  it("classifies by card-issuing bank country; ERIP is domestic", () => {
    expect(paymentOrigin(tx({ credit_card: { issuer_country: "BY" } }))).toEqual({ origin: "domestic", issuerCountry: "BY" });
    expect(paymentOrigin(tx({ credit_card: { issuer_country: "ru" } }))).toEqual({ origin: "foreign", issuerCountry: "RU" });
    expect(paymentOrigin(tx({ payment_method_type: "erip" }))).toEqual({ origin: "domestic", issuerCountry: "BY" });
    expect(paymentOrigin(tx())).toEqual({ origin: "unknown" });
  });

  it("totals foreign payments per country and per group, matched or not", () => {
    const report = buildGroupReport(
      [
        tx({ customer: { email: "olga@example.com" }, credit_card: { issuer_country: "RU" } }),
        tx({ customer: { email: "olga@example.com" }, credit_card: { issuer_country: "BY" }, amount: 10000 }),
        tx({ credit_card: { issuer_country: "KZ" }, amount: 20000 }), // unmatched, still declared
        tx({ payment_method_type: "erip", amount: 30000 }),
      ],
      roster(),
    );
    expect(report.origins.foreign).toEqual({ count: 2, totals: { BYN: "750.00" } });
    expect(report.origins.domestic).toEqual({ count: 2, totals: { BYN: "400.00" } });
    expect(report.foreignByCountry).toEqual({
      RU: { count: 1, totals: { BYN: "550.00" } },
      KZ: { count: 1, totals: { BYN: "200.00" } },
    });
    expect(report.groups[0]).toMatchObject({ groupCode: "Альфа-25.1", totals: { BYN: "650.00" }, foreignTotals: { BYN: "550.00" } });
  });
});
