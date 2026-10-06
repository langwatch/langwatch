import { defineConfig } from "vitest/config";

/** The ledger suite: needs `LANGWATCH_TEST_DATABASE_URL` and `LANGWATCH_TEST_CLICKHOUSE_URL`. */
export default defineConfig({
  test: {
    fsModuleCache: true,
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
