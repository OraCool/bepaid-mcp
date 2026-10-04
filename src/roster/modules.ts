import type ExcelJS from "exceljs";
import { groupSlug } from "../matching/trackingId.js";
import { toMinorUnits } from "../money.js";
import { cellText } from "./cells.js";

// Optional sheet "Модули": one row per group module with its date and price.
// Columns (located by header in row 1): Группа | Встреча | Дата | Цена | Валюта.
// Used to resolve payments of payers enrolled in several groups and as the default link amount.

export interface GroupModule {
  groupSlug: string;
  meeting?: string; // "03"
  date?: string; // "YYYY-MM-DD"
  priceMinor?: number;
  currency: string;
}

export const MODULES_SHEET_NAMES = ["модули", "modules"];
const DEFAULT_CURRENCY = "BYN";

const COLUMNS = {
  group: ["группа", "group"],
  meeting: ["встреча", "модуль", "meeting", "module"],
  date: ["дата", "date"],
  price: ["цена", "price"],
  currency: ["валюта", "currency"],
} as const;

export function readModulesSheet(workbook: ExcelJS.Workbook, warnings: string[]): GroupModule[] {
  const sheet = workbook.worksheets.find((ws) => MODULES_SHEET_NAMES.includes(ws.name.trim().toLowerCase()));
  if (!sheet) return [];

  const columns = new Map<keyof typeof COLUMNS, number>();
  sheet.getRow(1).eachCell((cell, n) => {
    const text = cellText(cell).toLowerCase();
    for (const [field, aliases] of Object.entries(COLUMNS)) {
      if ((aliases as readonly string[]).includes(text)) columns.set(field as keyof typeof COLUMNS, n);
    }
  });
  if (!columns.has("group")) {
    warnings.push(`Sheet "${sheet.name}": no "Группа" column in row 1, sheet ignored`);
    return [];
  }

  const modules: GroupModule[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const get = (field: keyof typeof COLUMNS) => {
      const col = columns.get(field);
      return col ? cellText(row.getCell(col)) : "";
    };
    const group = get("group");
    if (!group) continue;

    const where = `Sheet "${sheet.name}" row ${r}`;
    const date = parseDate(get("date"));
    if (get("date") && !date) warnings.push(`${where}: unrecognized date "${get("date")}"`);
    let priceMinor: number | undefined;
    if (get("price")) {
      try {
        priceMinor = toMinorUnits(get("price").replaceAll(/\s/g, ""));
      } catch {
        warnings.push(`${where}: invalid price "${get("price")}"`);
      }
    }
    const meeting = get("meeting").replaceAll(/\D/g, "");
    modules.push({
      groupSlug: groupSlug(group),
      meeting: meeting ? meeting.padStart(2, "0") : undefined,
      date,
      priceMinor,
      currency: (get("currency") || DEFAULT_CURRENCY).toUpperCase(),
    });
  }
  return modules;
}

/** "2026-09-14", "14.09.2026" -> "2026-09-14". */
export function parseDate(text: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  if (dotted) return `${dotted[3]}-${dotted[2]!.padStart(2, "0")}-${dotted[1]!.padStart(2, "0")}`;
  return undefined;
}
