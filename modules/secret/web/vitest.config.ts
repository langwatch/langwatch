import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { moduleVitestTestOptions } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/secret-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: moduleVitestTestOptions({
    kind: "jsdom",
    test: {
      setupFiles: ["./vitest.setup.ts"],
      // One screen, three dialogs driven through real user events. The same
      // budget every other feature-web package took, for the same reason: a
      // Chakra overlay under a loaded worker pool is slow, not broken.
      testTimeout: 30_000,
    },
  }),
});
