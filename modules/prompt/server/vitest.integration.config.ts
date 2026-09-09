import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts`, excluded from the unit lane. The
 * tag-catalogue suite asserts against real rows, at
 * `LANGWATCH_TEST_DATABASE_URL`, and skips cleanly without one.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts", "tests/**/*.integration.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
