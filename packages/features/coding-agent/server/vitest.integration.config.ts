import { defineConfig } from "vitest/config";

/**
 * This package's integration lane: every `*.integration.test.ts` under src/,
 * which `vitest.config.ts` excludes from the unit lane by the same suffix. The
 * two configs are complements, so a file cannot be in neither.
 *
 * WHAT IT NEEDS
 *
 *   Redis, for the mapping-throttle suite, which drives the real staging Lua.
 *   It takes `CI_REDIS_URL`/`TEST_REDIS_URL` when the job supplies one and
 *   starts a container otherwise. The two ClickHouse-shaped suites need no
 *   datastore at all: they record HTTP against a fixture endpoint.
 *
 * `include` was a single literal path — `tests/subscribers/pull-request-mapping-
 * throttle.integration.test.ts` — and the file has since moved under `src/`.
 * Nothing ran this config, so nothing noticed; run it as it stood and vitest
 * exits 1 with "No test files found". A glob over the suffix cannot rot that
 * way, because the suffix is what the unit config excludes by.
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
  resolve: {
    alias: {
      "@langwatch/coding-agent-contract/testing": new URL(
        "../contract/src/testing.ts",
        import.meta.url,
      ).pathname,
      "@langwatch/coding-agent-contract": new URL("../contract/src/index.ts", import.meta.url)
        .pathname,
      "@langwatch/github-contract": new URL("../../github/contract/src/index.ts", import.meta.url)
        .pathname,
      "@langwatch/project-contract": new URL("../../project/contract/src/index.ts", import.meta.url)
        .pathname,
      zod: new URL(
        "../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js",
        import.meta.url,
      ).pathname,
    },
  },
});
