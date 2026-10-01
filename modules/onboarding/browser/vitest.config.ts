import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // Several files mock the same modules (the api map, the experiment registration, the screens)
  // with different shapes; a shared registry lets one file's mock leak into the next.
  isolate: true,
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // The welcome flow animates between screens and the product flow drives a
    // multi-step form through real user events. The same budget every other
    // feature-web package took, for the same reason.
    testTimeout: 30_000,
  },
});
