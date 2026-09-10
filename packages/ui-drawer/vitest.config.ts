import { defineModuleVitestConfig } from "../test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "jsdom",
  isolate: false,
  test: {
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
  },
});
