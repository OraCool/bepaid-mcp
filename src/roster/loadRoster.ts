import { stat } from "node:fs/promises";
import ExcelJS from "exceljs";
import { normalizeEmail, normalizePhone } from "../matching/normalize.js";
import { groupSlug, payerKey } from "../matching/trackingId.js";
import { cellText } from "./cells.js";
import { type ManualAssignment, readManualSheet } from "./manual.js";
import { type GroupModule, readModulesSheet } from "./modules.js";

// Reads the payer roster workbook (read-only). Layout:
// - sheet "Groups": one row per group (+ location/type/payment URL); a group may have several rows (Belarus + EU+).
// - optional column "Программа" in "Groups": the payment description bePaid shows for the group's payments.
// - optional sheet "Ручные сопоставления": manual payment assignments (see manual.ts).
// - optional sheet "Модули": module dates and prices per group (see modules.ts).
// - one sheet per group: B1 = group code, header row (usually row 3) starting with the payer column
//   ("Плательщик", "Обучающийся" or "Payer").
//   Columns vary between sheets (extra/missing columns, typos like "Телергам ник"), so columns are found by header name.

export type PaymentChannel = "bepaid" | "stripe" | "other";

export interface Group {
  code: string; // as written in B1, e.g. "Альфа-25.1"
  slug: string; // ASCII, used in tracking ids
  sheetName: string;
  locations: string[]; // "Belarus", "EU+"
  types: string[]; // "Обучение", "Обучение с инвойсом", ...
  programs: string[]; // normalized payment descriptions of the group (column "Программа")
  modules: GroupModule[]; // from the "Модули" sheet, sorted by date
}

export interface Payer {
  id: string; // unique per roster row: "<group slug>#<row>"
  groupCode: string;
  name: string; // payer column: "Плательщик" / "Обучающийся" / "Payer"
  latinName?: string; // "First Name + Last Name"
  fullName?: string; // "Имя Фамилия Отчество"
  email?: string; // normalized
  phone?: string; // normalized (last 9 digits)
  rawPhone?: string;
  telegram?: string;
  paymentChannel?: PaymentChannel;
  key?: string; // stable key used in tracking ids (from email, else phone)
}

export interface Roster {
  path: string;
  groups: Group[];
  payers: Payer[];
  manual: ManualAssignment[]; // sheet "Ручные сопоставления"
  warnings: string[]; // rows that could not be read
}

const PAYER_HEADERS = ["плательщик", "обучающийся", "payer"];
const COLUMN_ALIASES: Record<keyof Omit<Payer, "id" | "groupCode" | "key" | "phone">, string[]> = {
  name: PAYER_HEADERS,
  latinName: ["first name + last name"],
  fullName: ["имя фамилия отчество"],
  email: ["email", "e-mail"],
  rawPhone: ["phone", "телефон"],
  telegram: ["телеграм ник", "телергам ник", "telegram"],
  paymentChannel: ["cпособ оплаты", "способ оплаты"], // first variant starts with a Latin "C"
};

export interface RosterOptions {
  /**
   * Substrings identifying bePaid payment URLs in the "Способ оплаты" column, besides "bepaid" itself
   * (e.g. the hostname of the own website that hosts the bePaid payment page). Case-insensitive.
   */
  bepaidUrlMarkers?: string[];
}

let cache: { key: string; mtimeMs: number; roster: Roster } | undefined;

/** Loads the roster, re-reading the file only when it changed on disk. */
export async function loadRoster(path: string, options: RosterOptions = {}): Promise<Roster> {
  const { mtimeMs } = await stat(path);
  const key = JSON.stringify([path, options]);
  if (cache?.key === key && cache.mtimeMs === mtimeMs) return cache.roster;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const roster = parseRosterWorkbook(workbook, { ...options, path });
  cache = { key, mtimeMs, roster };
  return roster;
}

export function parseRosterWorkbook(
  workbook: ExcelJS.Workbook,
  { path = "<memory>", bepaidUrlMarkers = [] }: RosterOptions & { path?: string } = {},
): Roster {
  const markers = ["bepaid", ...bepaidUrlMarkers].map((m) => m.trim().toLowerCase()).filter(Boolean);
  const groupMeta = readGroupsSheet(workbook.getWorksheet("Groups"));
  const warnings: string[] = [];
  const modules = readModulesSheet(workbook, warnings);
  const groups: Group[] = [];
  const payers: Payer[] = [];

  for (const sheet of workbook.worksheets) {
    const headerRow = findHeaderRow(sheet);
    if (!headerRow) continue;
    const code = cellText(sheet.getCell("B1")) || sheet.name;
    const slug = groupSlug(code);
    const meta = groupMeta.get(slug);
    groups.push({
      code,
      slug,
      sheetName: sheet.name,
      locations: meta?.locations ?? [],
      types: meta?.types ?? [],
      programs: meta?.programs ?? [],
      modules: modules
        .filter((m) => m.groupSlug === slug)
        .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999")), // undated last
    });

    const columns = mapColumns(sheet.getRow(headerRow));
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const get = (field: keyof typeof COLUMN_ALIASES) => {
        const col = columns.get(field);
        return col ? cellText(row.getCell(col)) || undefined : undefined;
      };
      const name = get("name");
      if (!name) continue;
      const email = normalizeEmail(get("email"));
      const rawPhone = get("rawPhone");
      const phone = normalizePhone(rawPhone);
      const identifier = email ?? phone;
      payers.push({
        id: `${slug}#${r}`,
        groupCode: code,
        name,
        latinName: get("latinName"),
        fullName: get("fullName"),
        email,
        phone,
        rawPhone,
        telegram: get("telegram"),
        paymentChannel: detectChannel(get("paymentChannel"), markers),
        key: identifier ? payerKey(identifier) : undefined,
      });
    }
  }
  for (const slug of new Set(modules.map((m) => m.groupSlug))) {
    if (!groups.some((g) => g.slug === slug)) warnings.push(`Sheet "Модули": group "${slug}" has no group sheet`);
  }
  const manual = readManualSheet(workbook, warnings);
  return { path, groups, payers, manual, warnings };
}

function readGroupsSheet(sheet: ExcelJS.Worksheet | undefined) {
  const meta = new Map<string, { locations: string[]; types: string[]; programs: string[] }>();
  if (!sheet) return meta;
  const header = sheet.getRow(1);
  const col = (name: string) => {
    let found: number | undefined;
    header.eachCell((cell, n) => {
      if (cellText(cell).toLowerCase() === name) found = n;
    });
    return found;
  };
  const codeCol = col("группа");
  const locationCol = col("основная локация");
  const typeCol = col("тип");
  const programCol = col("программа");
  if (!codeCol) return meta;
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const code = cellText(row.getCell(codeCol));
    if (!code) continue;
    const entry = meta.get(groupSlug(code)) ?? { locations: [], types: [], programs: [] };
    addUnique(entry.locations, locationCol ? cellText(row.getCell(locationCol)) : "");
    addUnique(entry.types, typeCol ? cellText(row.getCell(typeCol)) : "");
    addUnique(entry.programs, programCol ? normalizeProgram(cellText(row.getCell(programCol))) : "");
    meta.set(groupSlug(code), entry);
  }
  return meta;
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number | undefined {
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    if (PAYER_HEADERS.includes(cellText(sheet.getRow(r).getCell(1)).toLowerCase())) return r;
  }
  return undefined;
}

function mapColumns(header: ExcelJS.Row) {
  const columns = new Map<keyof typeof COLUMN_ALIASES, number>();
  header.eachCell((cell, n) => {
    const text = cellText(cell).toLowerCase();
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(text) && !columns.has(field as keyof typeof COLUMN_ALIASES)) {
        columns.set(field as keyof typeof COLUMN_ALIASES, n);
      }
    }
  });
  return columns;
}

// The payment column holds the group's payment URL (via formula) or a direct bePaid checkout link.
function detectChannel(value: string | undefined, bepaidMarkers: string[]): PaymentChannel | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (bepaidMarkers.some((marker) => v.includes(marker))) return "bepaid";
  if (v.includes("stripe")) return "stripe";
  return "other";
}

function addUnique(list: string[], value: string) {
  if (value && !list.includes(value)) list.push(value);
}

/** «Основы терапии» / "основы  терапии" -> "основы терапии": used to compare payment descriptions. */
export function normalizeProgram(text: string | null | undefined): string {
  return (text ?? "").replaceAll(/[«»"“”„]/g, "").replaceAll(/\s+/g, " ").trim().toLowerCase();
}
