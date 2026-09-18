import { defineConfig } from "vitest/config";

/**
 * Integration lane (ClickHouse optional, datastore-free tests included).
 * Glob include to follow file renames. Serial forks (shared server cleanup).
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
