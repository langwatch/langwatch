import { defineModuleVitestConfig } from "../../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "jsdom",
  isolate: false,
  test: { environment: "jsdom", include: ["src/**/*.test.tsx"] },
});
