# Shamsy — order screen (trial task)

The screen where a sales adviser records a dealer order: fixed dollar prices, a discount per line,
one exchange rate for the whole order, and totals in US dollars and Sudanese pounds.

- **Live:** https://shamsy-orders-black.vercel.app
- **Stack:** Next.js 16 (App Router, TypeScript), Supabase (PostgreSQL + Auth), Tailwind CSS 4, Vercel
- **Note for the client:** [NOTES.md](NOTES.md): what I would do differently in the real build,
  and the points in the rules I'd like to confirm

## Demo accounts

The login page has buttons that fill these in. All data is invented.

| Role | Email | Password |
|---|---|---|
| Sales adviser | `sana@shamsy.test` | `sana-demo-2026` |
| Sales adviser | `marwa@shamsy.test` | `marwa-demo-2026` |
| Owner | `owner@shamsy.test` | `owner-demo-2026` |

## Try the worked example

1. Sign in as **Sana**, choose **Ahmed Trading**, and keep the rate at **8,200**.
2. Add **4 × SPF 6000 ES Plus**, $40 off: **1.94%, sand, $2,020**.
3. Add **2 × Hope 5.0L-B1**, $70 off: **4.32%, red, $1,550**.
4. Add **1 × Hope 16.0LM-A1**, $150 off: **7.25%, blocked, $1,920**. *Save order* is disabled.
5. Remove line 3: **$3,570 = 29,274,000 SDG**. Save.
6. Build the same three lines again and tap **Ask owner to approve** on line 3. In a second window,
   sign in as **Owner**, open **Approvals**, and tap **Approve**. Sana's screen updates by itself:
   **$5,490 = 45,018,000 SDG**. Save.
7. As Owner, open **Settings** and set today's rate to **9,000**. Reopen the saved order: it still
   shows **8,200** and **45,018,000 SDG**.
8. Start a new order and type **7,900** as the rate: it is refused, and on leaving the field it goes
   back to **8,000**.

Afterwards, set today's rate back to 8,200 in Settings.

## The rules, and where each one is enforced

The browser only previews. **Every rule is enforced in PostgreSQL**, so calling the API directly,
or even writing the tables with the service-role key, meets the same rules.
Everything is in `supabase/migrations/`.

| Rule | Enforced by |
|---|---|
| Prices are fixed; only the owner may override one | `place_order()` takes each price from `products`; a different price from anyone but the owner → `PRICE_LOCKED` |
| Discount per line: above 0% up to 3% sand, above 3% up to 5% red, above 5% blocked | The trigger `check_order_line` runs on every `order_lines` insert, recomputes the % and the colour from cents, and requires a blocked line to carry a matching, unused approval from the owner → `DISCOUNT_NEEDS_APPROVAL` / `APPROVAL_INVALID` |
| One rate per order, never below the minimum | The trigger `check_order` on `orders` → `RATE_BELOW_MINIMUM`. The minimum is a setting the owner changes, not a constant. |
| A saved order never changes | Triggers block `UPDATE`, `DELETE` and `TRUNCATE` on `orders` and `order_lines` for every role → `ORDER_IMMUTABLE` |
| Pounds always equal dollars × the stored rate | `CHECK (total_sdg_piastres = total_usd_cents * rate_sdg_per_usd)`; the order total must equal the sum of its lines, checked when the transaction commits |
| Money is whole numbers | `bigint` US cents and SDG piastres (1/100 pound) throughout; no floating point in SQL or TypeScript |
| Advisers see only their own orders; no one sees another tenant | Row level security on every table. All writes go through `SECURITY DEFINER` functions; nobody can write the tables directly. |

A discount's colour is decided on exact cents (`discount × 10000 ≤ line value × 500`), never on the
rounded percentage: exactly 5.00% is red and saves, while 5.004% shows as "5.00%" but is blocked.
The thresholds (300 and 500 basis points) are settings too.

### Owner approval of a line above 5%

An unsaved order has no id yet, so an approval is bound to what was approved: **dealer, product,
quantity, unit price and discount**. It can be used once. The adviser taps *Ask owner to approve*;
the owner sees the request under **Approvals** and approves it; the adviser's screen picks it up by
itself (it polls every 4 seconds, which holds up better on 3G than a socket). If the adviser then
changes the discount, quantity or dealer, the approval no longer counts. When the owner records an
order themselves, their *Approve this discount* button takes effect immediately.

## Proving the 5% block holds on the server

```bash
npm run prove -- https://shamsy-orders-black.vercel.app   # without a URL: http://localhost:3000
```

The script signs in as the adviser and tries to save 1 × Hope 16.0LM-A1 with $150 off (7.25%) and
no approval, four ways:
- through `/api/orders`
- straight to the database API
- claiming the line is "sand" at 1%
- writing the `orders` table directly

All four are refused. The same checks, and more, run in `tests/db` and `tests/e2e`.

By hand, against the live demo:

```bash
SUPABASE=https://kdpaffjxrycgvddqannu.supabase.co
KEY=sb_publishable_pdODWW3n-X2aSTWQ59wC_Q_Mi9zNCpz      # public: the same key every browser receives

# 1. Sign in as the adviser and copy "access_token" from the response
curl -s "$SUPABASE/auth/v1/token?grant_type=password" -H "apikey: $KEY" \
  -H "Content-Type: application/json" -d '{"email":"sana@shamsy.test","password":"sana-demo-2026"}'
TOKEN=<access_token>

# 2. Look up the ids of the dealer and the product
curl -s "$SUPABASE/rest/v1/customers?select=id,name" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN"
curl -s "$SUPABASE/rest/v1/products?select=id,sku"   -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN"

# 3. Try to save the 7.25% line
curl -i https://shamsy-orders-black.vercel.app/api/orders \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"client_ref":"<any new uuid>","customer_id":"<Ahmed Trading id>","rate":8200,
       "lines":[{"product_id":"<HOPE-16.0LM-A1 id>","quantity":1,"discount_usd_cents":15000}]}'
# → HTTP 422 {"code":"DISCOUNT_NEEDS_APPROVAL","message":"Line 1: a discount of 7.25% is above 5.00% ..."}
```

## Working on a dropped connection

- **Drafts survive:** the order being built is kept on the phone (`localStorage`), so a reload or a
  closed tab loses nothing.
- **Saved to the phone first:** *Save* writes the order to an outbox on the phone, then sends it. If
  the connection drops, the order stays there and is sent when the connection returns (straight
  away, then every 30 seconds).
- **No duplicates:** each order carries a `client_ref` made on the phone, and the server stores an
  order once per `client_ref`. A retry after a timeout never creates a second order.
- **Never dropped silently:** if the server refuses a queued order (for example, because the owner
  raised the minimum rate in the meantime), it stays on the phone marked *refused*, with the reason.
- **Opens offline:** a service worker (`public/sw.js`) keeps the screen available, so once the app
  has been opened online it opens and reloads with no signal. The products, dealers and rates come
  from the last good load.
- **Needs a connection:** asking the owner for an approval.

## Getting started

Requirements: Node.js 22 or later, and a Supabase project (the free plan is enough).

```bash
npm install
cp .env.example .env.local        # fill in the four values below
npm run db:push                   # apply supabase/migrations to the database
npm run seed                      # tenant, 4 products, 3 dealers, 3 users (safe to re-run)
npm run dev                       # http://localhost:3000
```

| Variable | Where to find it | Used by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → Data API | the app, scripts, tests |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys | the app, scripts, tests |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys | the seed script and the tests only; never the app |
| `DATABASE_URL` | Supabase → Connect → Session pooler (URL-encode special characters in the password) | `npm run db:push` only |

A local Supabase (`npx supabase start`, which needs Docker) works too: put its URL and keys in
`.env.local`.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development server, production build, production server |
| `npm run typecheck` / `lint` | TypeScript and ESLint |
| `npm run db:push` | Apply the migrations to `DATABASE_URL` |
| `npm run seed` | Create or refresh the demo tenant, products, dealers and users |
| `npm run prove -- <url>` | Show that the 7.25% line is refused on the server |
| `npm test` | Unit tests |
| `npm run test:db` | Database tests |
| `npm run test:e2e` | Phone walkthrough; run `npm run build` first (it serves the build with `next start`) |
| `npm run test:all` | All of the above tests, plus a build |

## Tests

| Suite | Tests | What it covers |
|---|---|---|
| `npm test` | 51 | Money arithmetic and every number in the worked example, the exact 3% / 5% boundaries, the order draft, the offline outbox, error codes |
| `npm run test:db` | 28 | The database rules through the public API, as each role: the worked example, every way around the 5% block, prices, rates, approvals, immutable orders, duplicates, visibility between advisers and between tenants |
| `npm run test:e2e` | 9 | A Pixel 7-sized browser: the whole worked example with the owner approving from a second session, the minimum rate, a direct API call, saving offline, opening the app with no signal, a console-clean pass over every screen for each role, and no sideways scroll at 360px |

`test:db` and `test:e2e` create a fresh tenant with its own users on every run, so they never touch
the demo data and never depend on each other. Saved orders can't be deleted, by design, so the test
tenants stay behind; no one else can see them.

## Project layout

```
supabase/migrations/          schema, rules (triggers), row level security, API functions
src/
  app/
    (app)/                    signed-in screens: orders/new, orders, orders/[id], approvals, settings
    api/orders/route.ts       POST /api/orders → place_order()
    login/                    sign-in page
    layout.tsx, globals.css   root layout and the house style
  components/
    order-screen.tsx          the order screen
    app-shell.tsx             sidebar on a laptop, ☰ menu on a phone
    page-header.tsx           page header with today's rate, panels
    notice.tsx, styles.ts     shared message box and class names
    use-*.ts                  catalogue cache, outbox, online status
    service-worker.tsx        registers public/sw.js
  lib/
    money.ts                  integer money arithmetic and formatting (mirrors the SQL)
    order-draft.ts            what the screen derives from the order being built
    outbox.ts, send-order.ts  the write-to-phone-first queue and its sender
    api-errors.ts             database error → API error code and HTTP status
    supabase/                 browser and server clients
  i18n/en.ts                  every user-facing string (Arabic will be one more file)
  proxy.ts                    keeps the session fresh; sends signed-out visitors to /login
scripts/                      seed, db push, the proof script, shared fixtures
tests/db/                     database rules through the public API
tests/e2e/                    the phone walkthrough (Playwright)
```

The design follows the client's dashboard prototype: the logo, colours, green sidebar, the page
header with today's rate, the panels and the badges.

## Deployment

Vercel needs two environment variables: `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The app never needs the secret key at runtime. `vercel.json`
runs the functions in Frankfurt (`fra1`), next to the database: every page makes a few database
calls, and making them across the Atlantic tripled page times.

CI (`.github/workflows/ci.yml`) runs the typecheck, lint, unit tests and the build on every push.
With the repository secrets `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`
set, it also runs the database and phone tests.
