import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { configDefaults } from "vitest/config";

export default defineModuleVitestConfig({
  kind: "node",
  // Five suites replace the dispatcher with vi.mock, each differently, so each
  // file needs its own registry.
  isolate: true,
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
