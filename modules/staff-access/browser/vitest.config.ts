import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Dialogs and a typed confirmation driven through real user events: a Chakra overlay
    // under a loaded worker pool is slow, not broken.
    testTimeout: 30_000,
  },
});
