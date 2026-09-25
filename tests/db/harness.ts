import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { adminClient, env, seedTenant, type UserSpec } from "../../scripts/fixtures";

/**
 * Every test run gets its own tenant and users, so runs never interfere with each other
 * or with the demo data. Saved orders are immutable by design, so test tenants are left in place.
 */
export async function createWorld() {
  const admin = adminClient();
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  const users: Record<"owner" | "adviser" | "adviser2" | "warehouse", UserSpec> = {
    owner: { email: `owner-${tag}@test.shamsy.invalid`, password: `pw-${randomUUID()}`, full_name: "Test Owner", role: "owner", order_prefix: "OW" },
    adviser: { email: `sana-${tag}@test.shamsy.invalid`, password: `pw-${randomUUID()}`, full_name: "Test Sana", role: "adviser", order_prefix: "SA" },
    adviser2: { email: `marwa-${tag}@test.shamsy.invalid`, password: `pw-${randomUUID()}`, full_name: "Test Marwa", role: "adviser", order_prefix: "MA" },
    warehouse: { email: `jawahir-${tag}@test.shamsy.invalid`, password: `pw-${randomUUID()}`, full_name: "Test Jawahir", role: "warehouse", order_prefix: "WH" },
  };
  const seeded = await seedTenant(admin, { tenantId, tenantName: `Test ${tag}`, users: Object.values(users) });

  const product = (skuStart: string) => {
    const p = seeded.products.find((x) => x.sku.startsWith(skuStart));
    if (!p) throw new Error(`no product ${skuStart}`);
    return p;
  };
  const customer = seeded.customers.find((c) => c.name === "Ahmed Trading")!;

  async function signIn(u: UserSpec): Promise<{ client: SupabaseClient; token: string; id: string }> {
    const client = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email: u.email, password: u.password });
    if (error) throw error;
    return { client, token: data.session!.access_token, id: data.user!.id };
  }

  return {
    admin,
    tenantId,
    users,
    customer,
    customers: seeded.customers,
    spf6000: product("SPF-6000"),
    hope5: product("HOPE-5.0"),
    hope16: product("HOPE-16.0"),
    signIn,
  };
}

/** The three lines of the worked example, as the phone sends them. */
export function workedExampleLines(w: Awaited<ReturnType<typeof createWorld>>) {
  return {
    line1: { product_id: w.spf6000.id, quantity: 4, discount_usd_cents: 4000 },
    line2: { product_id: w.hope5.id, quantity: 2, discount_usd_cents: 7000 },
    line3: { product_id: w.hope16.id, quantity: 1, discount_usd_cents: 15000 },
  };
}

/** Calls the database API over plain HTTP, the way anyone with a stolen token could. */
export async function rawRpc(token: string, fn: string, body: unknown) {
  const res = await fetch(`${env("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export { randomUUID };
