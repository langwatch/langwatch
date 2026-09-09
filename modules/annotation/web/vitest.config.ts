import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // The screen's suite drives real user events through Chakra overlays; under
    // a fully loaded worker pool the slowest of them clears 5s while passing
    // comfortably alone, so the budget reflects the suite rather than the
    // default. The same budget gateway-web, automation-web and agent-web took.
    testTimeout: 30_000,
  },
});
