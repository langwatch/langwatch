import { defineConfig } from "vitest/config";

/**
 * Isolated from the application's vitest config, same reason as
 * packages/clickhouse/vitest.config.ts: this package has no application
 * dependency and must not acquire one through the test runner.
 */
export default defineConfig({
  test: {
    watch: false,
    testTimeout: 10000,
    // RAM guardrails (CLAUDE.md, "Vitest RAM trap") — without them vitest
    // defaults to the forks pool at `availableParallelism - 1` workers.
    pool: "vmForks",
    maxWorkers: process.env.CI ? "100%" : "50%",
    vmMemoryLimit: process.env.CI ? "1GB" : "512MB",
    include: ["src/**/*.unit.test.ts"],
  },
});
