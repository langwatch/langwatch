import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // The landing screen drives a combobox and a redirect effect through real
    // user events; the same budget every other feature-web package took.
    testTimeout: 30_000,
  },
});
