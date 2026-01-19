import { config } from "dotenv";
import os from "os";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

config();

const getMaxWorkers = (): number | undefined => {
  if (process.env.VITEST_MAX_WORKERS) {
    return parseInt(process.env.VITEST_MAX_WORKERS, 10);
  }
  if (process.env.VITEST_CPU_PERCENT) {
    const percent = parseInt(process.env.VITEST_CPU_PERCENT, 10) / 100;
    return Math.max(1, Math.floor(os.cpus().length * percent));
  }
  return undefined;
};

export default defineConfig({
  test: {
    watch: false,
    maxWorkers: getMaxWorkers(),
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
