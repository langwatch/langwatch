import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` under `src/`, excluded from the
 * unit lane. Needs Postgres, at `DATABASE_URL` — how a dataset list counts its
 * entries is a statement about the reads it issues, so the suite that pins it
 * runs against real rows.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
