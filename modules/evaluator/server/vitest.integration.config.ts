import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` and repository contract
 * suites, needing Postgres at `LANGWATCH_TEST_DATABASE_URL`. Runs
 * Prisma and the memory twin together for one comparable report.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts", "src/**/*.contract.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
