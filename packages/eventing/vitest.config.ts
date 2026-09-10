import { configDefaults } from "vitest/config";
import { defineModuleVitestConfig } from "../test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  test: {
    environment: "node",
    testTimeout: 30_000,
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
