import { describe, expect, it } from "vitest";
import { parseRosterWorkbook } from "../src/roster/loadRoster.js";
import { buildRosterWorkbook } from "./fixtures/roster.js";

describe("roster", () => {
  const roster = parseRosterWorkbook(buildRosterWorkbook(), { bepaidUrlMarkers: ["pay.example.by"] });

  it("detects group sheets by header and reads the code from B1", () => {
    expect(roster.groups.map((g) => [g.code, g.sheetName, g.slug])).toEqual([
      ["Альфа-25.1", "Альфа 25.1", "alfa-25.1"],
      ["Бета 25", "Бета 25", "beta-25"],
    ]);
    expect(roster.groups[0]!.locations).toEqual(["Belarus", "EU+"]);
  });

  it("maps columns by header name despite shifts and typos", () => {
    const maria = roster.payers.find((s) => s.name === "Мария Сидорова")!;
    expect(maria).toMatchObject({
      groupCode: "Бета 25",
      latinName: "Maria Sidorova",
      phone: "447654321",
      telegram: "@masha",
      paymentChannel: "bepaid",
    });
    expect(maria.email).toBeUndefined();
    expect(maria.key).toMatch(/^[0-9a-f]{8}$/); // derived from phone
  });

  it("normalizes contacts and detects the payment channel", () => {
    const [anna, olga] = roster.payers.filter((s) => s.groupCode === "Альфа-25.1");
    expect(anna).toMatchObject({ email: "anna.ivanova@mail.ru", phone: "291112233", paymentChannel: "bepaid" });
    expect(olga).toMatchObject({ paymentChannel: "stripe" });
    expect(roster.payers).toHaveLength(4);
  });

  it("gives the same person the same key in every group", () => {
    const annas = roster.payers.filter((s) => s.email === "anna.ivanova@mail.ru");
    expect(annas).toHaveLength(2);
    expect(annas[0]!.key).toBe(annas[1]!.key);
  });
});
