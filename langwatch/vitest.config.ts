import { config } from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

config();

export default defineConfig({
  test: {
    watch: false,
    // vmForks over vmThreads: the VM context leaks memory by design, but a
    // forked child reclaims ALL of it on exit, whereas a worker THREAD's leak
    // accumulates in the shared process heap. Measured on src/features/traces-v2
    // (68 files): peak RSS 2.56GB (vmThreads) -> 573MB (vmForks), ~4.5x, for
    // ~15% more wall-clock. vmMemoryLimit still recycles a worker before its
    // context grows unbounded. See dev/docs/best_practices/vitest-performance.md.
    pool: "vmForks",
    maxWorkers: "50%", // Low default for local dev; CI overrides with VITEST_MAX_WORKERS
    vmMemoryLimit: "512MB", // Recycle a worker once its reused VM context hits this
    // isolate:false reuses one VM context across the files in a worker instead
    // of building a fresh module registry per file. Safe here because the suite
    // resets shared state between tests (test-setup.ts + clearMocks-style
    // cleanup), so cross-file leakage doesn't change results — verified across
    // 172 sampled files (traces-v2 + a broad server slice) with zero failures.
    // The full-suite CI test-unit shards are the scale check; if isolate:false
    // ever flakes a shard, drop this line first.
    isolate: false,
    testTimeout: 30000, // 30s default to handle slower CI runners
    // Global setup runs once before all tests. Unit needs no containers; this
    // only carries a CI-gated hard-floor that mirrors the integration
    // globalSetup, releasing the vitest finalize wedge on unit shards (which
    // otherwise lack a hard-floor → 25-min job timeout → app-ci cancel).
    globalSetup: ["./src/test-unit-global-setup.ts"],
    setupFiles: ["./test-setup.ts"],
    exclude: [
      ...configDefaults.exclude,
      "**/*.integration.test.{ts,tsx}",
      "**/*.stress.test.{ts,tsx}",
      "**/*.scenario.test.{ts,tsx}",
      "**/*.browser.test.{ts,tsx}",
      ".next/**/*",
      ".next-saas/**/*",
      "**/e2e/**/*",
    ],
    env: {
      /*
       * @see src/server/redis.ts, lines 8-11
       * This is to prevent the redis connection from being established during the test run.
       */
      BUILD_TIME: "1",
      // Skip t3-oss/env-nextjs validation - it throws when server env vars are
      // accessed from jsdom context (which it considers "client")
      SKIP_ENV_VALIDATION: "1",
    },
    experimental: {
      fsModuleCache: true,
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "~/": join(__dirname, "./src/"),
      "@ee/": join(__dirname, "./ee/"),
      "@app/": join(__dirname, "./src/server/app-layer/"),
    },
  },
});
