import { config } from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

config();

export default defineConfig({
  test: {
    watch: false,
    maxWorkers: "25%", // Override with VITEST_MAX_WORKERS env var
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
    },
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
