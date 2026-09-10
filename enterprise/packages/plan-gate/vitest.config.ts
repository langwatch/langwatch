import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: { include: ["tests/**/*.test.ts"] },
});
