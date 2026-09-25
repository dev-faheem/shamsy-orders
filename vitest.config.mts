import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts"] },
      },
      {
        // Integration tests talk to a real Supabase (local or hosted) through its public API,
        // exactly like a browser or an attacker would.
        extends: true,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          testTimeout: 30_000,
          fileParallelism: false,
          setupFiles: ["tests/db/load-env.ts"],
        },
      },
    ],
  },
});
