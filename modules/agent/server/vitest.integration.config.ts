import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts`, excluded from the unit lane.
 * Needs Postgres, at `DATABASE_URL`.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
