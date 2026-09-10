import { configDefaults } from "vitest/config";
import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  test: {
    watch: false,
    testTimeout: 10000,
    include: ["src/**/*.test.ts"],
    // The integration lane is its own config, because those suites need a
    // real Postgres and this one must stay runnable without any datastore.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
