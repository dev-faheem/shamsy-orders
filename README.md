# Shamsy — order screen (trial task)

The screen where a sales adviser records a dealer order: fixed dollar prices, a discount per line,
one exchange rate for the whole order, totals in US dollars and Sudanese pounds.

**Stack:** Next.js 16 (App Router, TypeScript), Supabase (Postgres + Auth), Tailwind CSS 4, Vercel.

## The rules, and where each one is enforced

The browser only previews. **Every rule is enforced in Postgres**, so calling the API directly,
or even writing the tables with the service-role key, meets the same rules.

| Rule | Enforced by (`supabase/migrations/…_orders.sql`) |
|---|---|
| Prices are fixed; only the owner may override one | `place_order()` takes the price from `products`; a different price from a non-owner → `PRICE_LOCKED` |
| Discount per line: ≤ 3% sand, ≤ 5% red, > 5% blocked | trigger `check_order_line` on every `order_lines` insert recomputes the % and colour from cents; blocked needs a matching, owner-decided, unused approval → `DISCOUNT_NEEDS_APPROVAL` / `APPROVAL_INVALID` |
| One rate per order, never below the minimum | trigger `check_order` on `orders` → `RATE_BELOW_MINIMUM`; the minimum is a setting the owner changes |
| A saved order never changes | triggers block `UPDATE`/`DELETE`/`TRUNCATE` on `orders` and `order_lines` for every role → `ORDER_IMMUTABLE` |
| Pounds always equal dollars × the stored rate | `CHECK (total_sdg_piastres = total_usd_cents * rate_sdg_per_usd)`; order total = sum of lines, checked at commit |
| Money is integers | `bigint` US cents and SDG piastres throughout; no floats in SQL or TypeScript |
| Advisers see their own orders; no one sees another tenant | row level security on every table; writes only through `SECURITY DEFINER` functions |

A discount's colour is decided on exact cents (`discount × 10000 ≤ value × 500`), never on the rounded
percentage: 5.004% shows as 5.00% but is still blocked.

### Owner approval of a line above 5%

An unsaved order has no id, so an approval is bound to what was approved: **dealer, product,
quantity, unit price and discount**. It can be used once. The adviser taps *Ask owner to approve*;
the owner sees it under **Approvals** and approves; the adviser's screen picks it up by itself
(polling every 4 s, which holds up better on 3G than a socket). If the adviser then changes the
discount, quantity or dealer, the approval stops counting. The owner's own orders are approved on
the spot.

## Proving the 5% block holds on the server

```bash
npm run prove -- https://<deployed-app>     # or with no argument for http://localhost:3000
```

Signs in as the adviser and tries to save 1 × Hope 16.0LM-A1 with $150 off (7.25%) four ways: through
`/api/orders`, straight to the database API, lying that the line is "sand" at 1%, and writing the
`orders` table directly. All four are refused. The same checks run in `tests/db` and `tests/e2e`.

By hand:

```bash
# 1. Get an access token for the adviser
curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" -d '{"email":"sana@shamsy.test","password":"sana-demo-2026"}'
# 2. Try to save the 7.25% line
curl -i "$APP/api/orders" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"client_ref":"<new uuid>","customer_id":"<id>","rate":8200,
       "lines":[{"product_id":"<Hope 16 id>","quantity":1,"discount_usd_cents":15000}]}'
# → HTTP 422 {"code":"DISCOUNT_NEEDS_APPROVAL", ...}
```

## Working on a dropped connection

- The order being built is kept on the phone (`localStorage`) — a reload or a closed tab loses nothing.
- **Save** writes the order to an outbox on the phone *first*, then sends it. If the connection drops,
  it stays there and is sent when the connection returns (every 30 s and on the `online` event).
- Each order carries a `client_ref` made on the phone. The server stores an order once per
  `client_ref`, so a retry after a timeout never makes a duplicate.
- If the server refuses a queued order (for example, the owner raised the minimum rate meanwhile),
  it is kept as *refused* with the reason, never silently dropped.
- A service worker keeps the screen itself available offline, so the app opens and reloads with no
  signal once it has been opened online. The product list, dealers and rates come from the last good
  load. Approvals need a connection. (Tested in `tests/e2e/offline-reload.spec.ts`.)

## Demo accounts (invented data)

| Role | Email | Password |
|---|---|---|
| Sales adviser | `sana@shamsy.test` | `sana-demo-2026` |
| Sales adviser | `marwa@shamsy.test` | `marwa-demo-2026` |
| Owner | `owner@shamsy.test` | `owner-demo-2026` |

## Local setup

```bash
npm install
cp .env.example .env.local        # fill in from the Supabase dashboard
npm run db:push                   # apply supabase/migrations
npm run seed                      # tenant, 4 products, 3 dealers, 3 users (safe to re-run)
npm run dev                       # http://localhost:3000
```

Supabase CLI local stack (`npx supabase start`, needs Docker) works too: put its URL and keys in `.env.local`.

## Tests

```bash
npm test            # unit: money arithmetic, discount tiers, the draft, the outbox (51 tests)
npm run test:db     # database rules through the public API, as each role (28 tests)
npm run test:e2e    # on a Pixel 7 screen: the worked example, owner approval, offline, a direct API call,
                    # reloading the app with no signal, every screen console-clean for each role,
                    # no sideways scroll at 360px (9 tests)
npm run test:all
```

`test:db` and `test:e2e` create a fresh tenant with its own users each run, so they never touch the
demo data and never depend on each other. (Saved orders can't be deleted, by design, so test tenants
stay behind; they are invisible to everyone else.)

## Project layout

```
supabase/migrations/          schema, rules (triggers), row level security, API functions
src/
  app/
    (app)/                    signed-in screens: orders/new, orders, orders/[id], approvals, settings
    api/orders/route.ts       POST /api/orders → place_order()
    login/                    sign-in page
    layout.tsx, globals.css   root layout and the house style (colours from the dashboard prototype)
  components/
    order-screen.tsx          the order screen
    app-shell.tsx             sidebar on a laptop, ☰ menu on a phone
    page-header.tsx           page header with today's rate, panels
    notice.tsx, styles.ts     shared message box and class names
    use-*.ts                  catalogue cache, outbox, online status
    service-worker.tsx        registers public/sw.js (offline page loads)
  lib/
    money.ts                  integer money arithmetic and formatting (mirrors the SQL)
    order-draft.ts            what the screen derives from the order being built
    outbox.ts, send-order.ts  write-to-phone-first queue and the sender
    api-errors.ts             database error → API error code and HTTP status
    supabase/                 browser and server clients
  i18n/en.ts                  every user-facing string (Arabic = one more file)
  proxy.ts                    keeps the session fresh, sends signed-out visitors to /login
scripts/                      seed, db push, proof script, shared fixtures
tests/db/                     database rules through the public API, as each role
tests/e2e/                    phone walkthrough with Playwright
```

## Deployment

Vercel, with two environment variables: `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The app never needs the secret key at runtime; only the
seed script and the tests use it. `vercel.json` pins the functions to Frankfurt (`fra1`), next to
the database: every page makes a few database calls, and making them across the Atlantic tripled
page times.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests and the build on every push. With
the `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` repository secrets set, it
also runs the database and phone tests.
