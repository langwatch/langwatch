import { configDefaults, defineConfig } from "vitest/config";

/**
 * Unit lane: everything but `*.integration.test.ts`, which needs Postgres and
 * ClickHouse and runs in `test:integration`.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
