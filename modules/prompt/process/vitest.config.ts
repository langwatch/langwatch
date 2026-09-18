import { defineModuleVitestConfig } from "@langwatch/test-harness/vitest-config";
import { configDefaults } from "vitest/config";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
