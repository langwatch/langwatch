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
    setupFiles: ["./test-setup.ts"],
    exclude: [
      ...configDefaults.exclude,
      "**/*.integration.test.ts",
      "**/*.stress.test.ts",
      ".next/**/*",
      ".next-saas/**/*",
      "**/e2e/**/*",
      "saas-src/**/*",
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
      "@app/": join(__dirname, "./src/server/app-layer/"),
      "@injected-dependencies.client": join(
        __dirname,
        "./src/injection/injection.client.ts",
      ),
      "@injected-dependencies.server": join(
        __dirname,
        "./src/injection/injection.server.ts",
      ),
    },
  },
});
