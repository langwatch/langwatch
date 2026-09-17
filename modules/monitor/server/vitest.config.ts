import { configDefaults } from "vitest/config";
import { defineModuleVitestConfig } from "@langwatch/test-harness/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [
      ...configDefaults.exclude,
      "src/**/*.integration.test.ts",
      "src/**/*.contract.test.ts",
    ],
  },
});
