/**
 * Vitest config for integration tests that only require PostgreSQL (no ClickHouse / Redis).
 * Run with: pnpm test:pg-integration
 */
import { config } from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

config();

export default defineConfig({
  test: {
    include: ["**/*.integration.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [
      ...configDefaults.exclude,
      // Exclude event-sourcing suites that need ClickHouse / Redis containers.
      // The durable process-manager store is Postgres-only and intentionally
      // remains in this config's test surface.
      "src/server/event-sourcing/__tests__/**",
      "src/server/event-sourcing/outbox/**",
      "src/server/event-sourcing/pipelines/**",
      "src/server/event-sourcing/projections/**",
      "src/server/event-sourcing/queues/**",
      "src/server/event-sourcing/replay/**",
      "src/server/event-sourcing/stores/**",
      ".next/**/*",
      ".next-saas/**/*",
      "saas-src/**/*",
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 15_000,
    fileParallelism: false,
    setupFiles: ["./test-setup.ts"],
    env: {
      BUILD_TIME: "1",
      SKIP_ENV_VALIDATION: "1",
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
