import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { configDefaults } from "vitest/config";

export default defineModuleVitestConfig({
  kind: "node",
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
