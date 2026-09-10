import { defineModuleVitestConfig } from "../../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
