import { defineConfig } from "vitest/config";

/**
 * This application's integration lane: every `*.integration.test.ts` under
 * `src/`, the complement of what `vitest.config.ts` excludes.
 */

/*
 * WHAT IT NEEDS: a build toolchain, and Postgres at `LANGWATCH_TEST_DATABASE_URL`
 * for the suites that name it. A file added here that reaches a datastore says
 * so rather than relying on a repository-wide rule to notice.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
});
