import { defineConfig } from "vitest/config";

/**
 * This package's integration lane: every `*.integration.test.ts` under `src/`,
 * which `vitest.config.ts` excludes by the same suffix. The two configs are
 * complements, so a file cannot be in neither.
 *
 * WHAT IT NEEDS
 *
 *   Postgres, at `DATABASE_URL`. The billing lookup's three-way verdict is a
 *   property of the query the repository emits, so proving it needs the real
 *   rows rather than a stub that can only repeat the answer it was given.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
