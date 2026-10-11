import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "unit",
  include: ["**/__tests__/*.unit.test.ts"],
  testTimeout: 10_000,
});
