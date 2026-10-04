# bepaid-mcp

MCP server for the [bePaid](https://docs.bepaid.by/ru) payment gateway:

> **Unofficial.** A community project, not affiliated with or endorsed by bePaid. It uses the public bePaid
> APIs with your own shop credentials.

- **Transactions** — list, look up and export transactions of a period (paginated report API) with fees,
  payouts, payer and card data, and the country of the card-issuing bank (domestic / foreign).
- **Payment links** — one-off checkout pages with your own `tracking_id` and required payer fields.
- **Roster module (optional)** — with a groups/payers workbook: payments per group and payer,
  per-payer payment links whose `tracking_id` identifies group, meeting and payer.

## Tools

Always available:

| Tool | Purpose |
|---|---|
| `bepaid_list_transactions` | Transactions for a period (compact rows + totals) |
| `bepaid_get_transaction` | Lookup by `uid` or `tracking_id`; also finds test transactions |
| `bepaid_export_transactions` | All transactions of a period to a new XLSX (summary + transactions) or CSV |
| `bepaid_create_payment_link` | One-off payment link: amount, description, `tracking_id`, payer fields |

Registered only when `ROSTER_XLSX_PATH` is set:

| Tool | Purpose |
|---|---|
| `roster_list_groups` | Groups from the roster workbook |
| `roster_find_payer` | Payer lookup by id, email, phone or name |
| `roster_payments_by_group` | Payments per group → payer, plus `ambiguous` / `unmatched` / `otherPrograms` |
| `roster_export_group_report` | Same report written to a new XLSX/CSV file |
| `roster_create_payment_link` | Payment link for a roster payer (prefilled payer, exact matching) |

## Setup

Getting the shop ID / secret key and the first test run: **[docs/credentials.md](docs/credentials.md)**.

Requires Node.js 20+. Register with Claude Code (runs the published package via `npx`):

```bash
claude mcp add bepaid --scope user \
  -e BEPAID_SHOP_ID=... -e BEPAID_SECRET_KEY=... \
  -- npx -y bepaid-mcp
```

Other MCP clients (Claude Desktop, Cursor, ...):

```json
{
  "mcpServers": {
    "bepaid": {
      "command": "npx",
      "args": ["-y", "bepaid-mcp"],
      "env": { "BEPAID_SHOP_ID": "...", "BEPAID_SECRET_KEY": "..." }
    }
  }
}
```

| Variable | Description |
|---|---|
| `BEPAID_SHOP_ID`, `BEPAID_SECRET_KEY` | Shop credentials (HTTP Basic auth for all bePaid APIs) |
| `BEPAID_TEST_MODE` | `true` by default — links are test payments; set `false` for real payments |
| `BEPAID_TIME_ZONE` | Time zone for report periods (default `Europe/Minsk`) |
| `BEPAID_RETURN_URL` | Optional redirect after checkout |
| `ROSTER_XLSX_PATH` | Optional roster workbook (read-only); enables the `roster_*` tools |
| `ROSTER_BEPAID_URL_MARKERS` | Comma-separated substrings identifying bePaid payment URLs in the roster |
| `EXPORT_DIR` | Output folder for exports (default `./exports`) |
| `EXPORT_LANGUAGE` | `ru` (default) or `en` — headers of `bepaid_export_transactions` |

From a local checkout:

```bash
npm install && npm run build
cp .env.example .env   # fill in; npm start / npm run inspect read it
claude mcp add bepaid -- node --env-file=/absolute/path/.env /absolute/path/dist/index.js
```

## Roster workbook format

- Sheet `Groups`: columns `Группа`, `Основная локация`, `Тип`, optional `Программа` — the payment description
  bePaid shows for the group's payments (e.g. `Основы терапии`; quotes and case are ignored).
- One sheet per group: cell `B1` holds the group code; a header row (within the first 10 rows) starts
  with the payer column `Плательщик` (also accepted: `Обучающийся`, `Payer`). Columns are located by header name: `First Name + Last Name`,
  `Имя Фамилия Отчество`, `Email`, `Phone`, `Телеграм ник`, `Способ оплаты`.
- Optional sheet `Модули` — one row per module, header in row 1:

  | Группа | Встреча | Дата | Цена | Валюта |
  |---|---|---|---|---|
  | Альфа-25.1 | 1 | 14.09.2026 | 550 | BYN |

  `Группа` is the group code (as in `B1` of the group sheet); `Дата` a date cell or `DD.MM.YYYY`;
  `Валюта` defaults to BYN. Unreadable rows are listed as warnings by `roster_list_groups`.
- Optional sheet `Ручные сопоставления` — assignments for payments that cannot be matched automatically
  (ERIP, a relative's card), header in row 1:

  | UID транзакции | Группа | Плательщик | Встреча | Комментарий |
  |---|---|---|---|---|
  | 12345-abcdef0123 | Альфа-25.1 | Анна Иванова | 3 | ЕРИП |

  Copy `UID транзакции` from the export. `Плательщик` accepts a name, email, phone or roster id.

## Payment matching

1. Manual assignment (`Ручные сопоставления`) by transaction UID.
2. `tracking_id` of links created by this server (exact group, meeting and payer).
3. Payment description → only groups with that `Программа`. A description no group has (e.g. an individual
   consultation) goes to «Другие программы»; groups without a `Программа` value always stay candidates.
4. Payer email → phone → name (first + last name, any order, Cyrillic or Latin) → name allowing Belarusian
   passport spellings (Volha = Ольга, Aliaksandra = Александра; reported as `name_fuzzy` — worth a glance).
5. If the payer studies in several groups:
   - **price** — the amount must equal the group's module price or a multiple of it (several modules paid
     at once). Exactly one fitting group wins; none fitting → left for review.
   - **date** — if several groups fit the price, the group with a module date nearest to the payment date wins.
   - Otherwise (no data, equal distance) the payment is listed as `ambiguous` for manual review.

   The report column «Группа выбрана по» shows which rule decided.

## Payment origin

Every payment carries the country of the card-issuing bank (`issuer_country` from bePaid; ERIP is always BY).
Reports total domestic / foreign payments, foreign ones per country and per group, and the export has a sheet
«Иностранные платежи» with all foreign payments (matched or not) for declaring them to the bank.

## Publishing

```bash
npm version patch        # or minor / major
npm publish              # prepublishOnly builds and runs the tests
```

## Development

```bash
npm test                 # vitest
npx vitest run test/report.test.ts -t "ambiguous"   # single file / test
npm run typecheck
npm run inspect          # MCP Inspector against dist/
```

Testing payments: in test mode use card `4200000000000000` (success) or `4005550000000019` (failure).

## License

MIT
