import dotenv from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

// Load env vars before test files are imported (env.mjs validates on import)
dotenv.config({ path: ".env" });

/**
 * Integration test config for tests that only need Prisma/Postgres.
 * Does NOT include testcontainers setup (ClickHouse, Redis).
 */
export default defineConfig({
  test: {
    setupFiles: ["./test-setup.ts"],
    include: ["**/*.integration.{test,spec}.?(c|m)[jt]s?(x)"],
    env: {
      DISABLE_LICENSE_ENFORCEMENT: "true",
    },
    exclude: [
      ...configDefaults.exclude,
      ".next/**/*",
      ".next-saas/**/*",
      "saas-src/**/*",
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
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
