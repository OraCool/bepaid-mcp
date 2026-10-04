/** One CSV cell; payer-supplied text (names, descriptions) must not be interpreted as a spreadsheet formula. */
export function csvCell(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV with a BOM, so Excel opens UTF-8 (Cyrillic) correctly. */
export function toCsv(rows: (string | number | boolean | undefined | null)[][]): string {
  return "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
