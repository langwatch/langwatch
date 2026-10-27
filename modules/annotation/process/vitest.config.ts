import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { configDefaults } from "vitest/config";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
