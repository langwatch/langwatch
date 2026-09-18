import { fileURLToPath } from "node:url";

import { moduleVitestTestOptions } from "@langwatch/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/authz-contract": fileURLToPath(
        new URL("../../authz/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/gateway-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/authz-browser-kit": fileURLToPath(
        new URL("../../authz/browser-kit/src/index.ts", import.meta.url),
      ),
      "@langwatch/model-provider-contract": fileURLToPath(
        new URL("../../model-provider/contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: moduleVitestTestOptions({
    kind: "jsdom",
    test: {
      setupFiles: ["./vitest.setup.ts"],
      // Drawer suites drive real user events through Chakra overlays; under a
      // fully loaded worker pool the slowest of them clears 5s while passing
      // comfortably alone, so the budget reflects the suite, not the default.
      testTimeout: 30_000,
    },
  }),
});
