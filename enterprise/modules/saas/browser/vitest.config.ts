import { defineModuleVitestConfig } from "@langwatch/test-harness/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  isolate: false,
  test: { environment: "jsdom", include: ["src/**/*.test.tsx"] },
});
