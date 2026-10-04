import { z } from "zod";

const envSchema = z.object({
  BEPAID_SHOP_ID: z.string().trim().optional(),
  BEPAID_SECRET_KEY: z.string().trim().optional(),
  BEPAID_TEST_MODE: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? true : !/^(false|0|no)$/i.test(v.trim()))),
  BEPAID_TIME_ZONE: z.string().trim().default("Europe/Minsk"),
  BEPAID_RETURN_URL: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.url().optional()),
  ROSTER_XLSX_PATH: z.string().trim().optional(),
  ROSTER_BEPAID_URL_MARKERS: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [])),
  EXPORT_DIR: z.string().trim().default("./exports"),
  EXPORT_LANGUAGE: z
    .string()
    .optional()
    .transform((v) => (v?.trim().toLowerCase() === "en" ? "en" : "ru") as "ru" | "en"),
});

export interface Config {
  credentials?: { shopId: string; secretKey: string };
  testMode: boolean;
  timeZone: string;
  returnUrl?: string;
  rosterPath?: string;
  bepaidUrlMarkers: string[];
  exportDir: string;
  exportLanguage: "ru" | "en";
}

// Missing credentials/roster are not fatal at startup: tools that need them report a clear error instead,
// so the server can still be inspected and roster-only tools keep working.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  return {
    credentials:
      parsed.BEPAID_SHOP_ID && parsed.BEPAID_SECRET_KEY
        ? { shopId: parsed.BEPAID_SHOP_ID, secretKey: parsed.BEPAID_SECRET_KEY }
        : undefined,
    testMode: parsed.BEPAID_TEST_MODE,
    timeZone: parsed.BEPAID_TIME_ZONE,
    returnUrl: parsed.BEPAID_RETURN_URL,
    rosterPath: parsed.ROSTER_XLSX_PATH || undefined,
    bepaidUrlMarkers: parsed.ROSTER_BEPAID_URL_MARKERS,
    exportDir: parsed.EXPORT_DIR,
    exportLanguage: parsed.EXPORT_LANGUAGE,
  };
}
