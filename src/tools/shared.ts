import { z } from "zod";
import type { ReportQuery } from "../bepaid/reports.js";
import { DATE_TYPES, PAYMENT_METHOD_TYPES } from "../bepaid/types.js";
import type { ToolContext } from "./context.js";

const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/, 'Use "YYYY-MM-DD" or "YYYY-MM-DD hh:mm:ss"');

export const rangeShape = {
  from: dateInput.describe("Start of the period (inclusive), shop time zone"),
  to: dateInput.describe("End of the period (inclusive), shop time zone"),
  date_type: z.enum(DATE_TYPES).default("paid_at").describe("Which transaction date the period applies to"),
  payment_method_types: z
    .array(z.enum(PAYMENT_METHOD_TYPES))
    .optional()
    .describe("Defaults to all: credit_card, alternative, erip"),
};

export const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
export const WRITES_FILE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
export const CREATES_PAYMENT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

type RangeArgs = {
  from: string;
  to: string;
  date_type: ReportQuery["dateType"];
  payment_method_types?: NonNullable<ReportQuery["paymentMethodTypes"]>;
};

export function toQuery(ctx: ToolContext, args: RangeArgs, status: ReportQuery["status"] = "successful"): ReportQuery {
  return {
    from: args.from,
    to: args.to,
    dateType: args.date_type,
    status,
    paymentMethodTypes: args.payment_method_types,
    timeZone: ctx.config.timeZone,
  };
}

/** Resolves the test flag of a new payment link; real links need BEPAID_TEST_MODE=false. */
export function linkTestMode(ctx: ToolContext, requested: boolean | undefined): boolean {
  const test = requested ?? ctx.config.testMode;
  if (!test && ctx.config.testMode) {
    throw new Error("Real payment links are disabled: the server runs with BEPAID_TEST_MODE=true");
  }
  return test;
}

export function expiresIn(hours: number): Date {
  return new Date(Date.now() + hours * 3_600_000);
}
