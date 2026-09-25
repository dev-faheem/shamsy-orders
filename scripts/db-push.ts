/**
 * Applies supabase/migrations to the database in DATABASE_URL (from .env.local).
 *
 *   npm run db:push
 */
import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import { env } from "./fixtures";

config({ path: ".env.local", quiet: true });

const result = spawnSync("npx", ["supabase", "db", "push", "--yes", "--db-url", env("DATABASE_URL")], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
