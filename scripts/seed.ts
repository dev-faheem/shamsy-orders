/**
 * Seeds the demo environment: the Shamsy tenant, the four trial products, three dealers,
 * one owner and two advisers. Safe to run more than once.
 *
 *   npm run seed
 */
import { config } from "dotenv";
import { adminClient, seedTenant, type UserSpec } from "./fixtures";

config({ path: ".env.local", quiet: true });

export const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";

export const DEMO_USERS: UserSpec[] = [
  { email: "owner@shamsy.test", password: "owner-demo-2026", full_name: "Owner", role: "owner", order_prefix: "OW" },
  { email: "sana@shamsy.test", password: "sana-demo-2026", full_name: "Sana (Dongola)", role: "adviser", order_prefix: "SA" },
  { email: "marwa@shamsy.test", password: "marwa-demo-2026", full_name: "Marwa (Khartoum)", role: "adviser", order_prefix: "MA" },
];

async function main() {
  const result = await seedTenant(adminClient(), {
    tenantId: DEMO_TENANT_ID,
    tenantName: "Shamsy",
    users: DEMO_USERS,
    resetSettings: process.argv.includes("--reset-rates"),
  });
  console.log(`Seeded ${result.products.length} products, ${result.customers.length} customers, users:`);
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(8)} ${u.email}  /  ${u.password}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
