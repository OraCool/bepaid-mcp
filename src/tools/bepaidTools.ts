import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createCheckout } from "../bepaid/checkout.js";
import { collectTransactions } from "../bepaid/reports.js";
import { getTransactionByUid, getTransactionsByTrackingId } from "../bepaid/transactions.js";
import { REPORT_STATUSES } from "../bepaid/types.js";
import { matchTransaction } from "../matching/match.js";
import { toMinorUnits } from "../money.js";
import { toPaymentRow } from "../report/aggregate.js";
import { exportTransactions, summarizeTransactions } from "../report/transactionsExport.js";
import { jsonResult, safe, type ToolContext } from "./context.js";
import { CREATES_PAYMENT, READ_ONLY, WRITES_FILE, expiresIn, linkTestMode, rangeShape, toQuery } from "./shared.js";

// Generic bePaid tools: work with shop credentials only, no roster needed.

export function registerBepaidTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "bepaid_list_transactions",
    {
      title: "List bePaid transactions",
      description: "Lists bePaid transactions for a period (paginated report API) as compact rows. Test transactions are not included by bePaid.",
      inputSchema: {
        ...rangeShape,
        status: z.enum(REPORT_STATUSES).default("successful"),
        limit: z.number().int().min(1).max(1000).default(200).describe("Maximum rows returned"),
      },
      annotations: READ_ONLY,
    },
    safe(async (args) => {
      const transactions = await collectTransactions(ctx.client, toQuery(ctx, args, args.status));
      return jsonResult({
        total: transactions.length,
        truncated: transactions.length > args.limit,
        summary: summarizeTransactions(transactions),
        transactions: transactions.slice(0, args.limit).map((tx) => ({ ...toPaymentRow(tx), type: tx.type, status: tx.status })),
      });
    }),
  );

  server.registerTool(
    "bepaid_get_transaction",
    {
      title: "Get bePaid transaction",
      description:
        "Looks up a transaction by its uid, or all transactions with a given tracking_id. Also finds test " +
        "transactions, which the report API does not return. With a roster configured, shows the matched group/payer.",
      inputSchema: {
        uid: z.string().optional(),
        tracking_id: z.string().optional(),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ uid, tracking_id }) => {
      if (Boolean(uid) === Boolean(tracking_id)) throw new Error("Provide exactly one of uid or tracking_id");
      const transactions = uid
        ? [await getTransactionByUid(ctx.client, uid)]
        : await getTransactionsByTrackingId(ctx.client, tracking_id!);
      const roster = ctx.rosterEnabled ? await ctx.getRoster() : undefined;
      return jsonResult(
        transactions.map((tx) => ({
          ...toPaymentRow(tx),
          type: tx.type,
          status: tx.status,
          receipt_url: tx.receipt_url,
          ...(roster && { match: describeMatch(matchTransaction(tx, roster)) }),
        })),
      );
    }),
  );

  server.registerTool(
    "bepaid_export_transactions",
    {
      title: "Export bePaid transactions",
      description:
        "Writes all transactions of a period to a new XLSX (summary + transactions sheets) or CSV file: amounts, " +
        "fees, payouts, payer, card, issuing bank country (domestic/foreign). Totals cover successful payments.",
      inputSchema: {
        ...rangeShape,
        status: z.enum(REPORT_STATUSES).default("all"),
        format: z.enum(["xlsx", "csv"]).default("xlsx"),
        language: z.enum(["ru", "en"]).optional().describe("Column headers; defaults to EXPORT_LANGUAGE"),
      },
      annotations: WRITES_FILE,
    },
    safe(async (args) => {
      const transactions = await collectTransactions(ctx.client, toQuery(ctx, args, args.status));
      const file = await exportTransactions(transactions, {
        dir: ctx.config.exportDir,
        format: args.format,
        from: args.from,
        to: args.to,
        language: args.language ?? ctx.config.exportLanguage,
      });
      return jsonResult({ file, summary: summarizeTransactions(transactions) });
    }),
  );

  server.registerTool(
    "bepaid_create_payment_link",
    {
      title: "Create bePaid payment link",
      description:
        "Creates a one-off bePaid payment page (checkout token) and returns its URL. " +
        "Links are test payments unless the server runs with BEPAID_TEST_MODE=false.",
      inputSchema: {
        amount: z.string().describe('Amount in major units, e.g. "550.00"'),
        currency: z.string().length(3).default("BYN"),
        description: z.string().min(1).max(255).describe("Shown to the payer"),
        tracking_id: z.string().max(255).optional().describe("Your order/reference id, returned with the transaction"),
        customer_email: z.email().optional(),
        customer_first_name: z.string().optional(),
        customer_last_name: z.string().optional(),
        require_customer_fields: z
          .array(z.enum(["email", "first_name", "last_name", "phone"]))
          .optional()
          .describe("Fields the payer must fill in on the payment page"),
        expires_in_hours: z.number().int().min(1).max(24 * 30).default(72),
        test: z.boolean().optional().describe("Defaults to the server test mode"),
      },
      annotations: CREATES_PAYMENT,
    },
    safe(async (args) => {
      const test = linkTestMode(ctx, args.test);
      const expiresAt = expiresIn(args.expires_in_hours);
      const link = await createCheckout(ctx.client, {
        amountMinor: toMinorUnits(args.amount),
        currency: args.currency.toUpperCase(),
        description: args.description,
        trackingId: args.tracking_id,
        expiresAt,
        test,
        returnUrl: ctx.config.returnUrl,
        customer: { email: args.customer_email, firstName: args.customer_first_name, lastName: args.customer_last_name },
        visibleFields: args.require_customer_fields,
      });
      return jsonResult({
        url: link.redirectUrl,
        test,
        amount: `${args.amount} ${args.currency.toUpperCase()}`,
        tracking_id: args.tracking_id,
        expires_at: expiresAt.toISOString(),
      });
    }),
  );
}

function describeMatch(match: ReturnType<typeof matchTransaction>) {
  switch (match.status) {
    case "matched":
      return { status: match.status, group: match.payer.groupCode, payer: match.payer.name, by: match.by, meeting: match.meeting, resolvedBy: match.resolvedBy };
    case "ambiguous":
      return { status: match.status, by: match.by, candidates: match.candidates.map((c) => `${c.groupCode}: ${c.name}`) };
    default:
      return match;
  }
}
