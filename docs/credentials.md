# Getting bePaid API credentials

All bePaid APIs used by this server (reports, transaction lookup, payment links) authenticate with one
pair of values of the **shop**: the shop ID and the shop secret key (HTTP Basic auth, ID as user name,
key as password). There are no separate tokens per API.

Sources: [ID и секретный ключ](https://docs.bepaid.by/ru/using_api/id_key/),
[Отчеты для магазина](https://docs.bepaid.by/ru/payment_management/reports/reports_shop/),
[Тестирование](https://docs.bepaid.by/ru/using_api/testing/).

## 1. Find the shop ID and secret key

1. Sign in to the bePaid merchant back office (личный кабинет bePaid).
2. Open the **«Магазины»** tab.
3. Click **«Подробнее»** next to the shop that receives the payments.
4. In the **«Идентификационные данные»** block (below «Настройки») click
   **«Показать рабочие данные магазина»** (older back-office versions and the bePaid docs call it
   «Показать секретный ключ магазина»). It reveals:
   - **«ID»** — the shop ID → `BEPAID_SHOP_ID`
   - the shop **secret key** → `BEPAID_SECRET_KEY`

   The same place may also show the shop **public key** — it is only needed for verifying webhooks,
   which this server does not use.

If you do not have access to the back office (for example, the payment page is run by a website developer),
ask the account owner or bePaid support to grant you a user, or to send the two values over a secure channel.

> The secret key gives full API access to the shop (including creating payments). Do not send it by
> ordinary email or chat, do not commit it, and do not put it into shared documents.

## 2. Check API access with bePaid support

The documentation does not say whether the reports API needs to be enabled separately. Before the first
run, it is worth asking support to confirm for your shop:

- access to the **paginated transaction report** API (`POST https://merchant.bepaid.by/api/reports`,
  header `X-Api-Version: 3`);
- access to **payment tokens / Checkout** (`POST https://checkout.bepaid.by/ctp/api/checkouts`);
- whether payer **email and phone** are stored on transactions made through your payment page
  (reports match payments to payers by them). If they are not, the integration that creates your payments has to send them
  (`customer` / `settings.customer_fields`, see [Получение токена платежа](https://docs.bepaid.by/ru/integration/widget/payment_token/)).

Contacts: technical support **help@bepaid.by** (24/7), Telegram **@bePaidHelp_bot**. For connecting a shop:
sales@bepaid.by. Your bePaid manager can also enable 3-D Secure in test mode if you want to test it.

## 3. Configure the server

Register the server in Claude Code with the credentials as environment variables:

```bash
claude mcp add bepaid --scope user \
  -e BEPAID_SHOP_ID=<shop id> \
  -e BEPAID_SECRET_KEY=<secret key> \
  -e BEPAID_TEST_MODE=true \
  -e ROSTER_XLSX_PATH=/path/to/roster.xlsx \
  -e ROSTER_BEPAID_URL_MARKERS=<hostname of your payment page> \
  -- node /absolute/path/to/bepaid-mcp/dist/index.js
```

Claude Code stores these values in its own config (`~/.claude.json`) on your computer, not in this repository.
To change them later: `claude mcp remove bepaid --scope user` and add again.

## 4. Verify in test mode

Test mode uses the same credentials: a payment is a test one when the request has `"test": true`, which this
server sets while `BEPAID_TEST_MODE=true` (the default). Test payments do not move money.

1. In Claude Code, ask to create a payment link (tool `bepaid_create_payment_link`, or
   `roster_create_payment_link` for a roster payer).
   The result shows `"test": true`.
2. Open the link and pay with a test card (expiry date and CVC as described in
   [Тестовые данные](https://docs.bepaid.by/ru/integration/card_api/testing/)):
   - `4200 0000 0000 0000` — successful payment
   - `4005 5500 0000 0019` — declined payment
3. Look the payment up by the returned `tracking_id` (tool `bepaid_get_transaction`). The result must show
   `"test": true`, `"status": "successful"` and
   `"match": { "status": "matched", "group": ..., "payer": ..., "by": "tracking_id" }`.

The report API (`bepaid_list_transactions`, `roster_payments_by_group`, exports) does **not** return test
transactions, so a test payment is checked with `bepaid_get_transaction` only. Use a test payer
(a separate group sheet with your own email) so that receipts go to you; remove it after testing.

Errors you may see (the exact texts come from bePaid):

| Error | Meaning |
|---|---|
| `bePaid credentials are not configured` | `BEPAID_SHOP_ID` / `BEPAID_SECRET_KEY` are missing in the server config |
| `bePaid 401` | Most likely a wrong shop ID or secret key (check for spaces when copying) |
| `bePaid 403` / `404` on reports | The reports API may not be enabled for the shop — ask support |
| `Duplicate transaction` while testing | Same amount repeated quickly; change the amount slightly |

## 5. Switch to real payments

Only after the test run works: set `BEPAID_TEST_MODE=false` in the server config (remove and add the server
again with the new value). From then on, links created by `bepaid_create_payment_link` / `roster_create_payment_link` charge real money.
Reports only contain real payments (the report API leaves test transactions out).
