import { configDefaults } from "vitest/config";
import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
