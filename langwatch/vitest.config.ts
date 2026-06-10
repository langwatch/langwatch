import { config } from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

config();

export default defineConfig({
  test: {
    watch: false,
    pool: "vmThreads",
    maxWorkers: "50%", // Low default for local dev; CI overrides with VITEST_MAX_WORKERS
    vmMemoryLimit: "512MB", // Recycle workers aggressively — vmThreads leaks memory by design
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
