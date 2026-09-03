import { defineConfig } from "vitest/config";

/**
 * This package's integration lane: every `*.integration.test.ts` under src/,
 * which `vitest.config.ts` excludes from the unit lane by the same suffix.
 * Needs Redis — takes `CI_REDIS_URL`/`TEST_REDIS_URL` when the job supplies
 * one and starts a container otherwise.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
