import { configDefaults } from "vitest/config";
import { defineModuleVitestConfig } from "../../../../packages/test-harness/src/vitest-config.ts";

/**
 * Unit lane: everything but `*.integration.test.ts`, which needs Postgres and
 * ClickHouse and runs in `test:integration`.
 */

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: {
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
