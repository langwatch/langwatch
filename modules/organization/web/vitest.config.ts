import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { moduleVitestTestOptions } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/organization-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: moduleVitestTestOptions({
    kind: "jsdom",
    isolate: true,
    test: {
      setupFiles: ["./vitest.setup.ts"],
      // One screen with a date popover, a project select and a CSV export driven
      // through real user events. The same budget every other feature-web package
      // took, for the same reason: a Chakra overlay under a loaded worker pool is
      // slow, not broken.
      testTimeout: 30_000,
    },
  }),
});
