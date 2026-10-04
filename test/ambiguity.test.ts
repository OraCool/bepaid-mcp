import { describe, expect, it } from "vitest";
import type { Transaction } from "../src/bepaid/types.js";
import { matchTransaction } from "../src/matching/match.js";
import { parseRosterWorkbook } from "../src/roster/loadRoster.js";
import { parseDate } from "../src/roster/modules.js";
import { buildRosterWorkbook, type ModuleRow } from "./fixtures/roster.js";

// "Анна Иванова" (anna.ivanova@mail.ru) is enrolled in both "Альфа-25.1" and "Бета 25".
const rosterWith = (rows: ModuleRow[]) => parseRosterWorkbook(buildRosterWorkbook(rows));
const payment = (amount: number, paidAt: string, currency = "BYN"): Transaction => ({
  uid: "u",
  type: "payment",
  status: "successful",
  amount,
  currency,
  paid_at: paidAt,
  customer: { email: "anna.ivanova@mail.ru" },
});
const groupOf = (result: ReturnType<typeof matchTransaction>) =>
  result.status === "matched" ? [result.payer.groupCode, result.resolvedBy, result.meeting] : [result.status];

describe("modules sheet", () => {
  it("reads prices and dates in several formats and reports bad rows", () => {
    const roster = rosterWith([
      ["Альфа-25.1", 1, new Date(Date.UTC(2026, 8, 10)), 550, "BYN"],
      ["Альфа 25.1", "2", "24.09.2026", "550,00", ""],
      ["Альфа-25.1", 3, "someday", "много", "BYN"],
      ["Гамма", 1, "2026-09-01", 100, "BYN"],
    ]);
    const alpha = roster.groups.find((g) => g.code === "Альфа-25.1")!;
    expect(alpha.modules.slice(0, 2)).toEqual([
      { groupSlug: "alfa-25.1", meeting: "01", date: "2026-09-10", priceMinor: 55000, currency: "BYN" },
      { groupSlug: "alfa-25.1", meeting: "02", date: "2026-09-24", priceMinor: 55000, currency: "BYN" },
    ]);
    expect(roster.warnings).toHaveLength(3); // bad date, bad price, unknown group
  });

  it("parses dates", () => {
    expect(parseDate("2026-09-01T00:00:00Z")).toBe("2026-09-01");
    expect(parseDate("1.9.2026")).toBe("2026-09-01");
    expect(parseDate("Sept 1")).toBeUndefined();
  });
});

describe("payer enrolled in several groups", () => {
  const differentPrices = rosterWith([
    ["Альфа-25.1", 1, "2026-09-10", 550, "BYN"],
    ["Бета 25", 1, "2026-09-11", 600, "BYN"],
  ]);

  it("is assigned by module price", () => {
    expect(groupOf(matchTransaction(payment(55000, "2026-09-11T10:00:00Z"), differentPrices))).toEqual(["Альфа-25.1", "price", undefined]);
    expect(groupOf(matchTransaction(payment(60000, "2026-09-10T10:00:00Z"), differentPrices))).toEqual(["Бета 25", "price", undefined]);
  });

  it("accepts several modules paid at once", () => {
    expect(groupOf(matchTransaction(payment(110000, "2026-09-11T10:00:00Z"), differentPrices))[0]).toBe("Альфа-25.1");
  });

  it("leaves an amount that fits no group for review", () => {
    expect(groupOf(matchTransaction(payment(12345, "2026-09-11T10:00:00Z"), differentPrices))).toEqual(["ambiguous"]);
  });

  it("falls back to dates when no group has a price in the payment currency", () => {
    expect(groupOf(matchTransaction(payment(55000, "2026-09-11T10:00:00Z", "EUR"), differentPrices))).toEqual(["Бета 25", "date", "01"]);
  });

  const samePrice = rosterWith([
    ["Альфа-25.1", 1, "2026-09-10", 550, "BYN"],
    ["Альфа-25.1", 2, "2026-10-08", 550, "BYN"],
    ["Бета 25", 1, "2026-09-20", 550, "BYN"],
    ["Бета 25", 2, "2026-10-18", 550, "BYN"],
  ]);

  it("with equal prices is assigned to the group with the nearest module date", () => {
    expect(groupOf(matchTransaction(payment(55000, "2026-09-18T12:00:00Z"), samePrice))).toEqual(["Бета 25", "date", "01"]);
    expect(groupOf(matchTransaction(payment(55000, "2026-10-07T12:00:00Z"), samePrice))).toEqual(["Альфа-25.1", "date", "02"]);
  });

  it("stays ambiguous on equal distance", () => {
    expect(groupOf(matchTransaction(payment(55000, "2026-09-15T12:00:00Z"), samePrice))).toEqual(["ambiguous"]);
  });

  it("uses dates when not every group has a price, and never guesses without data", () => {
    const partial = rosterWith([
      ["Альфа-25.1", 1, "2026-09-10", 550, "BYN"],
      ["Бета 25", 1, "2026-09-20", null, "BYN"],
    ]);
    expect(groupOf(matchTransaction(payment(55000, "2026-09-19T12:00:00Z"), partial))).toEqual(["Бета 25", "date", "01"]);

    const onlyOneGroup = rosterWith([["Альфа-25.1", 1, "2026-09-10", 550, "BYN"]]);
    expect(groupOf(matchTransaction(payment(55000, "2026-09-10T12:00:00Z"), onlyOneGroup))).toEqual(["ambiguous"]);
  });
});
