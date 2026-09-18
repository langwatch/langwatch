import { configDefaults } from "vitest/config";
import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  test: {
    environment: "node",
    testTimeout: 30_000,
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
