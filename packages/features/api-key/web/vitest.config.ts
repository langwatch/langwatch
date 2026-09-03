import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // The screen suites drive real user events through Chakra drawers, menus
    // and a dialog that mounts a Shiki-backed code block; under a fully loaded
    // worker pool the slowest of them clears 5s while passing comfortably
    // alone. The same budget gateway-web, automation-web, agent-web,
    // data-retention-web and model-provider-web took.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@langwatch/api-key-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
    },
  },
});
