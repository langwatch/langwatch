import { defineConfig } from "vitest/config";

/**
 * This application's integration lane: every `*.integration.test.ts` under
 * `src/`, the complement of what `vitest.config.ts` excludes.
 */

/*
 * WHAT IT NEEDS: a build toolchain; live suites need Postgres, Redis and
 * ClickHouse at LANGWATCH_TEST_*_URL (memory-store suites need none). A file
 * added here that reaches a datastore says so.
 */
export default defineConfig({
  test: {
    fsModuleCache: true,
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
});
