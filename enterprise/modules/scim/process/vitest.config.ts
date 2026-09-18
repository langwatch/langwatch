import { defineModuleVitestConfig } from "@langwatch/test-harness/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
  },
});
