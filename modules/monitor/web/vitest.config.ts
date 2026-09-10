import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "jsdom",
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // One screen with a row-actions menu, a delete confirmation and a replicate
    // dialog driven through real user events. The same budget every other
    // feature-web package took, for the same reason: a Chakra overlay under a
    // loaded worker pool is slow, not broken.
    testTimeout: 30_000,
  },
});
