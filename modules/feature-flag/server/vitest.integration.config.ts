import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` plus repository contract
 * suites, against Postgres (`LANGWATCH_TEST_DATABASE_URL`). Runs Prisma
 * AND memory-twin cases here, so the two answers are comparable in one report.
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
