import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // Many suites here mock modules, and with isolation off those mocks
  // leaked across files (same symptom user/web and model-provider-web hit
  // and fixed the same way).
  isolate: true,
  test: {
    // Per-file rather than global: the visualization and model suites are pure
    // and run faster without a DOM, and every file that renders declares
    // `@vitest-environment jsdom` in its own docblock.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // The screen suites drive real user events through Chakra overlays and
    // recharts; under a fully loaded worker pool the slowest of them clears 5s
    // while passing comfortably alone, so the budget reflects the suite rather
    // than the default. The same budget gateway-web, automation-web, agent-web
    // and annotation-web took.
    testTimeout: 30_000,
  },
});
