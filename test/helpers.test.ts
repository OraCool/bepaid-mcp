import { describe, expect, it } from "vitest";
import { fromMinorUnits, toMinorUnits } from "../src/money.js";
import { nameTokens, normalizeEmail, normalizePhone } from "../src/matching/normalize.js";
import { decodeTrackingId, encodeTrackingId, groupSlug, payerKey } from "../src/matching/trackingId.js";

describe("money", () => {
  it("converts major to minor units without float errors", () => {
    expect(toMinorUnits("550")).toBe(55000);
    expect(toMinorUnits("550.5")).toBe(55050);
    expect(toMinorUnits("0,29")).toBe(29);
    expect(toMinorUnits(19.99)).toBe(1999);
  });

  it("rejects malformed amounts", () => {
    expect(() => toMinorUnits("1.999")).toThrow();
    expect(() => toMinorUnits("-5")).toThrow();
    expect(() => toMinorUnits("0")).toThrow();
    expect(() => toMinorUnits("abc")).toThrow();
  });

  it("formats minor units", () => {
    expect(fromMinorUnits(55000)).toBe("550.00");
    expect(fromMinorUnits(5)).toBe("0.05");
    expect(fromMinorUnits(-1999)).toBe("-19.99");
  });
});

describe("normalize", () => {
  it("normalizes emails", () => {
    expect(normalizeEmail("  Eva.Smith@Gmail.com ")).toBe("eva.smith@gmail.com");
    expect(normalizeEmail("not-an-email")).toBeUndefined();
    expect(normalizeEmail(null)).toBeUndefined();
  });

  it("compares phones by last 9 digits", () => {
    expect(normalizePhone("+375 (29) 123-45-67")).toBe("291234567");
    expect(normalizePhone(375291234567)).toBe("291234567");
    expect(normalizePhone("8029 1234567")).toBe("291234567");
    expect(normalizePhone("12345")).toBeUndefined();
  });

  it("produces script- and order-independent name tokens", () => {
    const cyr = nameTokens("Иванова Мария");
    const lat = nameTokens("MARIA IVANOVA");
    expect([...cyr].sort()).toEqual([...lat].sort());
  });
});

describe("trackingId", () => {
  it("slugifies Cyrillic group codes", () => {
    expect(groupSlug("Альфа 25.1")).toBe("alfa-25.1");
    expect(groupSlug("Группа-3.1")).toBe("gruppa-3.1");
  });

  it("round-trips", () => {
    const info = { groupSlug: "alfa-25.1", meeting: "3", payerKey: payerKey("a@b.by") };
    const id = encodeTrackingId(info);
    expect(id).toMatch(/^grp1\|alfa-25\.1\|03\|[0-9a-f]{8}$/);
    expect(decodeTrackingId(id)).toEqual({ ...info, meeting: "03" });
  });

  it("ignores foreign tracking ids", () => {
    expect(decodeTrackingId("order-12345")).toBeUndefined();
    expect(decodeTrackingId(undefined)).toBeUndefined();
  });
});
