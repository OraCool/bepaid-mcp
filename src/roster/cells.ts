import type ExcelJS from "exceljs";

/** Text of a cell regardless of type: formulas (cached result), hyperlinks, rich text, numbers, dates (YYYY-MM-DD). */
export function cellText(cell: ExcelJS.Cell): string {
  return valueText(cell.value);
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value !== "object") return "";
  if ("result" in value) return valueText(value.result);
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("").trim();
  if ("hyperlink" in value) return valueText("text" in value ? value.text : value.hyperlink);
  if ("text" in value) return valueText(value.text);
  return "";
}
