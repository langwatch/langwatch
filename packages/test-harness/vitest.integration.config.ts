import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` under `src/`, excluded from the
 * unit lane. `cleanup-test-rows` needs Postgres, at
 * `LANGWATCH_TEST_DATABASE_URL`; the nlpgo roundtrip suite needs a `go`
 * toolchain instead and self-skips without either.
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
