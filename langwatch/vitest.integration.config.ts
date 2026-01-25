import { config } from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

config();

export default defineConfig({
  test: {
    // Global setup runs once before all tests - starts shared containers
    globalSetup: [
      "./src/server/event-sourcing/__tests__/integration/globalSetup.ts",
    ],
    setupFiles: [
      // env-setup MUST run first to set REDIS_URL/CLICKHOUSE_URL before redis.ts is imported
      "./src/server/event-sourcing/__tests__/integration/env-setup.ts",
      "./test-setup.ts",
      "./src/server/event-sourcing/__tests__/integration/setup.ts",
    ],
    include: ["**/*.integration.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [
      ...configDefaults.exclude,
      ".next/**/*",
      ".next-saas/**/*",
      "saas-src/**/*",
    ],
    testTimeout: 60_000, // 60 seconds for testcontainers startup and processing
    hookTimeout: 60_000, // 60 seconds for beforeAll/afterAll hooks
    teardownTimeout: 30_000, // 30 seconds for cleanup
    // NOTE: BUILD_TIME is NOT set for integration tests because we need real Redis/ClickHouse connections.
    // The env-setup.ts file handles setting the correct URLs from globalSetup.
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "~/": join(__dirname, "./src/"),
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
