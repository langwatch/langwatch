import { fileURLToPath } from "node:url";

import { moduleVitestTestOptions } from "@langwatch/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/model-provider-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: moduleVitestTestOptions({
    kind: "jsdom",
    // Many suites here mock modules, and with isolation off those mocks
    // leaked across files (same symptom user/web hit and fixed the same way).
    isolate: true,
    test: {
      setupFiles: ["./vitest.setup.ts"],
      // The two screen suites drive real user events through Chakra menus and a
      // dialog; under a fully loaded worker pool the slowest of them clears 5s
      // while passing comfortably alone, so the budget reflects the suite rather
      // than the default. The same budget gateway-web, automation-web, agent-web
      // and data-retention-web took.
      testTimeout: 30_000,
    },
  }),
});
