/**
 * Proof that the 5% block holds on the server, not only in the screen.
 *
 * Signs in as the demo adviser (Sana) and tries to save a line with a 7.25% discount and no
 * approval, three ways: through the app's API, straight to the database API, and lying about the
 * discount colour. Every attempt must be refused. Nothing is saved (the demo data stays clean).
 *
 *   npm run prove                                  # against http://localhost:3000
 *   npm run prove -- https://your-app.vercel.app   # against the deployed app
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

const APP = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

async function main() {
  const db = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });
  const { data: auth, error } = await db.auth.signInWithPassword({ email: "sana@shamsy.test", password: "sana-demo-2026" });
  if (error) throw error;
  const token = auth.session!.access_token;

  const { data: product } = await db.from("products").select("id, name, price_usd_cents").eq("sku", "HOPE-16.0LM-A1").single();
  const { data: customer } = await db.from("customers").select("id, name").eq("name", "Ahmed Trading").single();
  const body = (extra: object = {}) => ({
    client_ref: randomUUID(),
    customer_id: customer!.id,
    rate: 8200,
    lines: [{ product_id: product!.id, quantity: 1, discount_usd_cents: 15000, ...extra }],
  });

  console.log(`Signed in as Sana (adviser). Line: 1 × ${product!.name} at $2,070 with $150 off = 7.25%, no approval.\n`);
  let allRefused = true;
  const report = (label: string, status: number, json: unknown) => {
    const refused = status >= 400;
    allRefused &&= refused;
    console.log(`${refused ? "REFUSED" : "ACCEPTED ✗"}  ${label}\n          HTTP ${status} ${JSON.stringify(json)}\n`);
  };

  const call = async (url: string, payload: unknown, headers: Record<string, string>) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
    return [r.status, await r.json().catch(() => null)] as const;
  };

  report(`POST ${APP}/api/orders`, ...(await call(`${APP}/api/orders`, body(), { Authorization: `Bearer ${token}` })));

  const b = body();
  report(
    `POST ${SUPABASE_URL}/rest/v1/rpc/place_order  (database API, skipping the app)`,
    ...(await call(
      `${SUPABASE_URL}/rest/v1/rpc/place_order`,
      { p_client_ref: b.client_ref, p_customer_id: b.customer_id, p_rate: b.rate, p_lines: b.lines },
      { apikey: KEY, Authorization: `Bearer ${token}` },
    )),
  );

  report(
    `POST ${APP}/api/orders  claiming discount_tier "sand", 1.00%`,
    ...(await call(`${APP}/api/orders`, body({ discount_tier: "sand", discount_bp: 100 }), { Authorization: `Bearer ${token}` })),
  );

  report(
    `POST ${SUPABASE_URL}/rest/v1/orders  (writing the table directly)`,
    ...(await call(
      `${SUPABASE_URL}/rest/v1/orders`,
      { order_number: "SA-9999", client_ref: randomUUID(), customer_id: customer!.id, rate_sdg_per_usd: 8200, total_usd_cents: 192000, total_sdg_piastres: 1574400000 },
      { apikey: KEY, Authorization: `Bearer ${token}` },
    )),
  );

  console.log(allRefused ? "All attempts refused by the server." : "SOMETHING WAS ACCEPTED — the block is not holding.");
  process.exit(allRefused ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
