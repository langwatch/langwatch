import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "jsdom",
  isolate: false,
  test: {
    watch: false,
    testTimeout: 10000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
