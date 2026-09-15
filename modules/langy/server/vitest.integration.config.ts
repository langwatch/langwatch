import { defineConfig } from "vitest/config";

/**
 * This package's integration lane: every `*.integration.test.ts` under src/,
 * which `vitest.config.ts` excludes from the unit lane by the same suffix.
 * Needs Redis, at `LANGWATCH_TEST_REDIS_URL` (or `REDIS_URL`) — resolved in
 * one place, `src/__tests__/support/test-redis-url.ts` — and starts a
 * container otherwise.
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
