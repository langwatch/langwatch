import { join } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// No `.env` of its own — `LANGWATCH_TEST_REDIS_URL` lives in the
// application's, same as packages/clickhouse's integration config.
config({ path: join(__dirname, "../../.env"), quiet: true });

export default defineConfig({
  test: {
    globalSetup: ["./src/__tests__/integration/globalSetup.ts"],
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    // Sequential files, forked processes (CLAUDE.md, "Hand-rolling a
    // throwaway vitest.*.config.ts").
    fileParallelism: false,
    pool: "forks",
  },
});
