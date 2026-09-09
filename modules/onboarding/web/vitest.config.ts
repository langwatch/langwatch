import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // The welcome flow animates between screens and the product flow drives a
    // multi-step form through real user events. The same budget every other
    // feature-web package took, for the same reason.
    testTimeout: 30_000,
  },
});
