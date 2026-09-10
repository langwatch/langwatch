import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "jsdom",
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // The welcome flow animates between screens and the product flow drives a
    // multi-step form through real user events. The same budget every other
    // feature-web package took, for the same reason.
    testTimeout: 30_000,
  },
});
