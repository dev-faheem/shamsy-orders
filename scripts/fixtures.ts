import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Test data from the trial brief. Prices in US cents. */
const PRODUCTS = [
  { sku: "SPF-6000-ES-PLUS", name: "SPF 6000 ES Plus — 6 kW inverter", price_usd_cents: 51500, sort_order: 1 },
  { sku: "SPE-12000-ES", name: "SPE 12000 ES — 12 kW inverter", price_usd_cents: 97500, sort_order: 2 },
  { sku: "HOPE-5.0L-B1", name: "Hope 5.0L-B1 — 5 kWh battery", price_usd_cents: 81000, sort_order: 3 },
  { sku: "HOPE-16.0LM-A1", name: "Hope 16.0LM-A1 — 16 kWh battery", price_usd_cents: 207000, sort_order: 4 },
] as const;

const CUSTOMERS = [
  { name: "Ahmed Trading", city: "Khartoum" },
  { name: "Nile Solar", city: "Omdurman" },
  { name: "Dongola Power", city: "Dongola" },
] as const;

const SETTINGS = {
  day_rate_sdg_per_usd: 8200,
  min_rate_sdg_per_usd: 8000,
  discount_sand_max_bp: 300,
  discount_red_max_bp: 500,
};

type Role = "owner" | "adviser" | "marketing" | "warehouse";
export interface UserSpec {
  email: string;
  password: string;
  full_name: string;
  role: Role;
  order_prefix: string;
}

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}

export function adminClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function must<R extends { data: unknown; error: unknown }>(
  p: PromiseLike<R>,
  what: string,
): Promise<R["data"]> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${JSON.stringify(error)}`);
  return data;
}

async function ensureUser(admin: SupabaseClient, u: UserSpec): Promise<string> {
  // listUsers is paginated; the seed only ever has a handful of users.
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const found = data?.users.find((x) => x.email === u.email);
  if (found) {
    await must(admin.auth.admin.updateUserById(found.id, { password: u.password }), `reset ${u.email}`);
    return found.id;
  }
  const created = await must(
    admin.auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true }),
    `create ${u.email}`,
  );
  return created.user!.id;
}

/**
 * Creates (or refreshes) one tenant with its settings, products, customers and users.
 * Idempotent for a given tenantId, so the seed can be run again safely.
 */
export async function seedTenant(
  admin: SupabaseClient,
  opts: { tenantId: string; tenantName: string; users: UserSpec[]; resetSettings?: boolean },
) {
  const { tenantId, tenantName, users } = opts;
  await must(admin.from("tenants").upsert({ id: tenantId, name: tenantName }), "tenant");

  const { data: existingSettings } = await admin.from("settings").select("tenant_id").eq("tenant_id", tenantId);
  if (!existingSettings?.length || opts.resetSettings) {
    await must(admin.from("settings").upsert({ tenant_id: tenantId, ...SETTINGS }), "settings");
  }

  await must(
    admin.from("products").upsert(PRODUCTS.map((p) => ({ ...p, tenant_id: tenantId })), { onConflict: "tenant_id,sku" }),
    "products",
  );

  const { data: existingCustomers } = await admin.from("customers").select("name").eq("tenant_id", tenantId);
  const missing = CUSTOMERS.filter((c) => !existingCustomers?.some((e) => e.name === c.name));
  if (missing.length) {
    await must(admin.from("customers").insert(missing.map((c) => ({ ...c, tenant_id: tenantId }))), "customers");
  }

  const ids: Record<string, string> = {};
  for (const u of users) {
    const id = await ensureUser(admin, u);
    await must(
      admin.from("profiles").upsert({
        id,
        tenant_id: tenantId,
        full_name: u.full_name,
        role: u.role,
        order_prefix: u.order_prefix,
      }),
      `profile ${u.email}`,
    );
    ids[u.email] = id;
  }

  const products = await must(
    admin.from("products").select("id, sku, name, price_usd_cents").eq("tenant_id", tenantId).order("sort_order"),
    "read products",
  );
  const customers = await must(
    admin.from("customers").select("id, name, city").eq("tenant_id", tenantId).order("name"),
    "read customers",
  );
  return { userIds: ids, products: products!, customers: customers! };
}
