import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "jsdom",
  isolate: true,
  test: {
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
  },
});
