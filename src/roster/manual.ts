import type ExcelJS from "exceljs";
import { cellText } from "./cells.js";

// Optional sheet "Ручные сопоставления": payments that cannot be matched automatically (ERIP without a name,
// a relative's card, ...). Columns (header in row 1): UID транзакции | Группа | Плательщик | Встреча | Комментарий.
// "Плательщик" (or "Обучающийся") accepts a roster payer id, email, phone or name within the group.
// A manual assignment always wins over automatic matching.

export interface ManualAssignment {
  uid: string;
  group: string;
  payer: string;
  meeting?: string;
  row: number;
}

export const MANUAL_SHEET_NAMES = ["ручные сопоставления", "manual"];

const COLUMNS = {
  uid: ["uid транзакции", "uid"],
  group: ["группа", "group"],
  payer: ["плательщик", "обучающийся", "payer"],
  meeting: ["встреча", "модуль", "meeting"],
} as const;

export function readManualSheet(workbook: ExcelJS.Workbook, warnings: string[]): ManualAssignment[] {
  const sheet = workbook.worksheets.find((ws) => MANUAL_SHEET_NAMES.includes(ws.name.trim().toLowerCase()));
  if (!sheet) return [];

  const columns = new Map<keyof typeof COLUMNS, number>();
  sheet.getRow(1).eachCell((cell, n) => {
    const text = cellText(cell).toLowerCase();
    for (const [field, aliases] of Object.entries(COLUMNS)) {
      if ((aliases as readonly string[]).includes(text)) columns.set(field as keyof typeof COLUMNS, n);
    }
  });
  if (!columns.has("uid") || !columns.has("group") || !columns.has("payer")) {
    warnings.push(`Sheet "${sheet.name}": row 1 must contain "UID транзакции", "Группа", "Плательщик"; sheet ignored`);
    return [];
  }

  const assignments: ManualAssignment[] = [];
  const seen = new Set<string>();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const get = (field: keyof typeof COLUMNS) => {
      const col = columns.get(field);
      return col ? cellText(row.getCell(col)) : "";
    };
    const uid = get("uid");
    if (!uid) continue;
    const where = `Sheet "${sheet.name}" row ${r}`;
    if (!get("group") || !get("payer")) {
      warnings.push(`${where}: "Группа" and "Плательщик" are required`);
      continue;
    }
    if (seen.has(uid)) {
      warnings.push(`${where}: transaction ${uid} is assigned more than once, first row is used`);
      continue;
    }
    seen.add(uid);
    const meeting = get("meeting").replace(/\D/g, "");
    assignments.push({ uid, group: get("group"), payer: get("payer"), meeting: meeting ? meeting.padStart(2, "0") : undefined, row: r });
  }
  return assignments;
}
