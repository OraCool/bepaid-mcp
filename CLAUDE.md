# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — compile `src/` → `dist/` (tsc, ESM, NodeNext). The MCP entrypoint is `dist/index.js`.
- `npm test` — vitest; single test: `npx vitest run test/report.test.ts -t "name"`.
- `npm run typecheck` — tsc without emit.
- `npm run test:coverage` — tests with v8 coverage (`coverage/lcov.info`, used by SonarQube).
- `npm run inspect` — MCP Inspector against the built server.
- Published to npm as `bepaid-mcp` (users run `npx -y bepaid-mcp`): `npm version <patch|minor|major>` then `npm publish`
  (`prepublishOnly` builds and tests). Only `dist/**/*.js` and `docs/credentials.md` are shipped (`files`); check with
  `npm pack --dry-run`. The server version is read from `package.json`.

## Architecture

stdio MCP server built on the official `@modelcontextprotocol/sdk` (`McpServer.registerTool` + zod input shapes).

- `src/index.ts` only wires config → `createServer` (`src/server.ts`) → stdio. Tests import `createServer` and connect
  through `InMemoryTransport` with an injected `ToolContext` (fake `fetch`, in-memory roster) — see `test/server.test.ts`.
- `src/tools/*` — tool handlers wrapped in `safe()` (errors become `isError` results, never crash the server).
  `bepaidTools.ts` = generic tools (always registered); `rosterTools.ts` = optional roster module, registered in
  `server.ts` only when `ctx.rosterEnabled` (`ROSTER_XLSX_PATH` set). The package is meant to be public: keep generic
  features free of roster assumptions. Missing credentials are reported per call, not at startup.
- General export: `src/report/transactionsExport.ts` (labels ru/en via `EXPORT_LANGUAGE`); roster report export:
  `src/report/export.ts` (Russian).
- `src/bepaid/*` — thin `fetch` client (`BepaidClient`, Basic auth `shop_id:secret_key`) and zod schemas using
  `z.looseObject` so unknown API fields pass through. Three hosts: `merchant.bepaid.by` (reports, `X-Api-Version: 3`),
  `gateway.bepaid.by` (transaction lookup), `checkout.bepaid.by` (checkout tokens, `X-Api-Version: 2`).
- Reports: `payment_method_type` is a required single value, so `iterateTransactions` queries `credit_card`,
  `alternative`, `erip` separately, follows `starting_after = last_object_id` while `has_more`, and dedupes by `uid`.
  There is no type filter in the API — refunds etc. are excluded client-side (`isIncomingPayment`).
- Matching (`src/matching/match.ts`): manual sheet by uid → `tracking_id` (format `grp1|<group slug>|<meeting>|<payer key>`, created by
  `roster_create_payment_link`) → program filter (`Groups` column `Программа` vs payment description; no fitting
  group → `other_program`) → email → phone (last 9 digits) → exact name tokens → `similarNameTokens` (Belarusian
  passport spellings via phonetic form + consonant skeleton ≥3; reported as `name_fuzzy`). Name matches fitting
  several different people are ambiguous.
  Candidates spanning several groups go to `resolveAmbiguity` (`src/matching/resolveAmbiguity.ts`):
  price rule (amount = module price × n, only if every candidate group has a price in that currency), then nearest
  module date (whole days, ties unresolved); anything undecided is reported as `ambiguous`, never guessed.
- Payer key = first 8 hex of sha256(normalized email, else phone) — changing normalization breaks matching of
  links already issued. Change the `grp1` prefix version instead of reinterpreting old ids.
- Roster (`src/roster/loadRoster.ts`): group sheets are detected by a header row starting with the payer column (`Плательщик` / `Обучающийся` / `Payer`),
  group code from `B1`, columns located by header name (sheets differ in column order and header spelling).
  Optional sheet `Модули` (`src/roster/modules.ts`) gives module dates/prices per group; bad rows become
  `roster.warnings` instead of errors. The workbook is only read, cached by mtime.
- Payment origin (`src/report/origin.ts`): card `issuer_country`, ERIP = BY. Foreign payments are summarized for
  all reported payments, matched or not (merchants may have to report payments from foreign banks).
- Money: amounts are integer minor units in the API; convert only via `src/money.ts` (string math, no floats).

## Conventions

- Tests, fixtures, comments, docs and example config must never contain real merchant or payer data (names, emails,
  phones, shop sites, receipts, local paths) — not even as reformatted examples. Use invented values such as
  `pay.example.by`, groups `Альфа-25.1` / `Бета 25`, phone `+375 29 123-45-67`.
- The roster workbook is only read; exports always go to new files in `EXPORT_DIR`.
- Payment links default to test mode (also when the flag is absent); real links require `BEPAID_TEST_MODE=false`.
- Response codes: `<letter>.<4 digits>` — S success, P pending/awaiting customer, F declined, E bePaid error;
  digits name the service (4000–4999 = 3-D Secure).
- Credentials/onboarding steps live in `docs/credentials.md`; keep it limited to what bePaid docs confirm.
- `private/`, `.env`, `exports/` and `coverage/` are git-ignored; never reference local-only files from tracked files.
- Observed in production: report timestamps are wall-clock times in the requested `time_zone` but suffixed `Z`
  (`src/bepaid/timeZone.ts` converts them back to UTC in `iterateTransactions`; `settled_at` is a date only);
  the report API omits test transactions; the gateway tracking_id lookup returns
  `{transactions: [...]}` with `id` = uid string (reports use numeric ids). Card `issuer_country` is always set.
- Unverified bePaid details: report page size, rate limits, `tracking_id` max length/charset.
