import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    // The run board and Agent Testing suites drive real user events through
    // Chakra overlays, a virtualised table and a period picker; the slowest of
    // them clears five seconds while passing comfortably alone, so the budget
    // reflects the suite rather than the default. The trace family's config
    // says the same thing about its explorer suites.
    testTimeout: 30_000,
  },
});
