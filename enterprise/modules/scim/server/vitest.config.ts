import { defineModuleVitestConfig } from "../../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
  },
});
