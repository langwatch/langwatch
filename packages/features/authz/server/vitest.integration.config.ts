import { defineConfig } from "vitest/config";

/**
 * This package's integration lane: every `*.integration.test.ts` under `src/`,
 * which `vitest.config.ts` excludes by the same suffix. The two configs are
 * complements, so a file cannot be in neither.
 *
 * WHAT IT NEEDS
 *
 *   Postgres, at `DATABASE_URL`. The grant-index suite seeds twenty thousand
 *   rows and asks the planner what it did with the read, which needs real
 *   statistics rather than a stub.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 120_000,
    hookTimeout: 180_000,
    teardownTimeout: 30_000,
  },
});
