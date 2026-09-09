import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // The screen suites drive real user events through Chakra menus, popovers
    // and a dialog; under a fully loaded worker pool the slowest of them clears
    // 5s while passing comfortably alone, so the budget reflects the suite
    // rather than the default. The same budget gateway-web, automation-web,
    // agent-web, data-retention-web and model-provider-web took.
    testTimeout: 30_000,
  },
});
