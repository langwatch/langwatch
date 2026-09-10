import { configDefaults } from "vitest/config";
import { defineModuleVitestConfig } from "../test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
