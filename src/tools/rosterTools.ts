import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createCheckout } from "../bepaid/checkout.js";
import { collectTransactions } from "../bepaid/reports.js";
import { encodeTrackingId } from "../matching/trackingId.js";
import { fromMinorUnits, toMinorUnits } from "../money.js";
import { buildGroupReport } from "../report/aggregate.js";
import { exportReport } from "../report/export.js";
import { findGroup, findPayers } from "../roster/findPayers.js";
import type { Group } from "../roster/loadRoster.js";
import { jsonResult, safe, type ToolContext } from "./context.js";
import { CREATES_PAYMENT, READ_ONLY, WRITES_FILE, expiresIn, linkTestMode, rangeShape, toQuery } from "./shared.js";

// Optional roster module: registered only when ROSTER_XLSX_PATH is set.
// Maps payments to groups/payers of a roster workbook and creates per-payer payment links.

const ROSTER_READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerRosterTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "roster_list_groups",
    {
      title: "List roster groups",
      description:
        "Lists groups from the roster workbook with location, type, payer counts and module prices/dates " +
        '(sheet "Модули"), plus warnings about roster rows that could not be read.',
      annotations: ROSTER_READ_ONLY,
    },
    safe(async () => {
      const roster = await ctx.getRoster();
      return jsonResult({
        groups: roster.groups.map((g) => {
          const payers = roster.payers.filter((s) => s.groupCode === g.code);
          return {
            code: g.code,
            locations: g.locations,
            types: g.types,
            programs: g.programs,
            payers: payers.length,
            payingViaBepaid: payers.filter((s) => s.paymentChannel === "bepaid").length,
            modules: g.modules.length,
            prices: [...new Set(g.modules.filter((m) => m.priceMinor).map((m) => `${fromMinorUnits(m.priceMinor!)} ${m.currency}`))],
            nextModule: g.modules.find((m) => m.date && m.date >= new Date().toISOString().slice(0, 10)),
          };
        }),
        manualAssignments: roster.manual.length,
        warnings: roster.warnings,
      });
    }),
  );

  server.registerTool(
    "roster_find_payer",
    {
      title: "Find payer",
      description: "Finds payers by roster id, email, phone or name (any order, Cyrillic or Latin).",
      inputSchema: {
        query: z.string().min(2),
        group: z.string().optional().describe("Restrict to one group"),
      },
      annotations: ROSTER_READ_ONLY,
    },
    safe(async ({ query, group }) => {
      const roster = await ctx.getRoster();
      const found = group ? findGroup(roster, group) : undefined;
      if (group && !found) throw new Error(`Unknown group "${group}". Use roster_list_groups.`);
      return jsonResult(findPayers(roster, query, found?.code));
    }),
  );

  server.registerTool(
    "roster_payments_by_group",
    {
      title: "bePaid payments by roster group",
      description:
        "Successful bePaid payments for a period grouped by roster group and payer. " +
        "Payments are matched by manual assignment, tracking_id (links created by roster_create_payment_link), then " +
        "payer email, phone, name (incl. Belarusian passport spellings), limited to groups of the payment's program. " +
        "Payments fitting several groups are listed under 'ambiguous', unknown payers under 'unmatched', " +
        "payments for programs without a group (e.g. consultations) under 'otherPrograms'.",
      inputSchema: {
        ...rangeShape,
        group: z.string().optional().describe("Only this group (code as in the roster)"),
      },
      annotations: READ_ONLY,
    },
    safe(async (args) => {
      const roster = await ctx.getRoster();
      const group = args.group ? findGroup(roster, args.group) : undefined;
      if (args.group && !group) throw new Error(`Unknown group "${args.group}". Use roster_list_groups.`);
      const transactions = await collectTransactions(ctx.client, toQuery(ctx, args));
      const report = buildGroupReport(transactions, roster, group?.code);
      return jsonResult(roster.warnings.length ? { ...report, rosterWarnings: roster.warnings } : report);
    }),
  );

  server.registerTool(
    "roster_export_group_report",
    {
      title: "Export roster group report",
      description: "Builds the per-group payment report for a period and writes it to a new XLSX or CSV file.",
      inputSchema: {
        ...rangeShape,
        format: z.enum(["xlsx", "csv"]).default("xlsx"),
      },
      annotations: WRITES_FILE,
    },
    safe(async (args) => {
      const roster = await ctx.getRoster();
      const transactions = await collectTransactions(ctx.client, toQuery(ctx, args));
      const report = buildGroupReport(transactions, roster);
      const file = await exportReport(report, { dir: ctx.config.exportDir, format: args.format, from: args.from, to: args.to });
      return jsonResult({
        file,
        groups: report.groups.length,
        payments: report.transactionCount,
        ambiguous: report.ambiguous.length,
        unmatched: report.unmatched.length,
        otherPrograms: report.otherPrograms.length,
        totals: report.totals,
      });
    }),
  );

  server.registerTool(
    "roster_create_payment_link",
    {
      title: "Create payment link for a payer",
      description:
        "Creates a one-off bePaid payment page for one payer of a roster group. " +
        "The link carries group, meeting and payer in tracking_id, so the payment is matched exactly in reports. " +
        "Links are test payments unless the server runs with BEPAID_TEST_MODE=false.",
      inputSchema: {
        group: z.string().describe("Group code as in the roster"),
        payer: z.string().describe("Roster payer id, email, phone or name within the group"),
        amount: z
          .string()
          .optional()
          .describe('Amount in major units, e.g. "550.00". Defaults to the module price from the "Модули" sheet'),
        currency: z.string().length(3).optional().describe("Defaults to the module currency, else BYN"),
        meeting: z.string().regex(/^\d{1,2}$/).optional().describe("Meeting/module number"),
        description: z.string().max(255).optional().describe("Shown to the payer; defaults to group and meeting"),
        expires_in_hours: z.number().int().min(1).max(24 * 30).default(72),
        test: z.boolean().optional().describe("Defaults to the server test mode"),
      },
      annotations: CREATES_PAYMENT,
    },
    safe(async (args) => {
      const test = linkTestMode(ctx, args.test);
      const roster = await ctx.getRoster();
      const group = findGroup(roster, args.group);
      if (!group) throw new Error(`Unknown group "${args.group}". Use roster_list_groups.`);

      const payers = findPayers(roster, args.payer, group.code);
      if (payers.length !== 1) {
        throw new Error(
          payers.length === 0
            ? `No payer "${args.payer}" in ${group.code}. Use roster_find_payer.`
            : `"${args.payer}" matches ${payers.length} payers in ${group.code}: ` +
                payers.map((s) => `${s.name} (${s.id})`).join(", "),
        );
      }
      const payer = payers[0]!;
      if (!payer.key) {
        throw new Error(`${payer.name} has no email or phone in the roster, so the payment could not be matched later`);
      }

      const price = resolvePrice(group, args.amount, args.currency, args.meeting);
      const trackingId = encodeTrackingId({ groupSlug: group.slug, meeting: args.meeting, payerKey: payer.key });
      const expiresAt = expiresIn(args.expires_in_hours);
      const [firstName, ...rest] = (payer.latinName ?? payer.name).split(/\s+/);
      const link = await createCheckout(ctx.client, {
        amountMinor: price.amountMinor,
        currency: price.currency,
        description: args.description ?? [group.code, args.meeting && `встреча ${args.meeting.padStart(2, "0")}`].filter(Boolean).join(", "),
        trackingId,
        expiresAt,
        test,
        returnUrl: ctx.config.returnUrl,
        customer: { email: payer.email, firstName, lastName: rest.join(" ") || undefined },
        // Without an email in the roster, ask the payer for one so the receipt reaches them.
        visibleFields: payer.email ? undefined : ["email"],
      });

      return jsonResult({
        url: link.redirectUrl,
        test,
        group: group.code,
        payer: { id: payer.id, name: payer.name, email: payer.email },
        amount: `${fromMinorUnits(price.amountMinor)} ${price.currency}`,
        tracking_id: trackingId,
        expires_at: expiresAt.toISOString(),
      });
    }),
  );
}

/** Explicit amount wins; otherwise the price of the given module, or the group's single module price. */
function resolvePrice(group: Group, amount: string | undefined, currency: string | undefined, meeting: string | undefined) {
  const modules = group.modules.filter((m) => m.priceMinor && (!currency || m.currency === currency.toUpperCase()));
  if (amount) {
    return { amountMinor: toMinorUnits(amount), currency: (currency ?? modules[0]?.currency ?? "BYN").toUpperCase() };
  }
  const forMeeting = meeting ? modules.filter((m) => m.meeting === meeting.padStart(2, "0")) : modules;
  const options = new Set(forMeeting.map((m) => `${m.priceMinor} ${m.currency}`));
  if (options.size === 0) {
    const what = meeting ? `${group.code} meeting ${meeting}` : group.code;
    throw new Error(`No module price for ${what} in sheet "Модули": pass amount`);
  }
  if (options.size > 1) throw new Error(`${group.code} has several module prices: pass amount or meeting`);
  const module = forMeeting[0]!;
  return { amountMinor: module.priceMinor!, currency: module.currency };
}
