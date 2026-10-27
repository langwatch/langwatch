import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { configDefaults } from "vitest/config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  isolate: true,
  test: {
    /**
     * Real-browser lane excluded, as `platform/app` did: the browser
     * test drives `vitest/browser`, which jsdom can't host — needs a
     * separate config CI never ran, same as analytics and traces.
     */
    exclude: [...configDefaults.exclude, "src/**/__tests__/**/*.browser.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // The evaluators screen drives a delete confirmation, a replicate dialog
    // and a push-to-replicas dialog through real user events. The same budget
    // every other feature-web package took, for the same reason: a Chakra
    // overlay under a loaded worker pool is slow, not broken.
    testTimeout: 30_000,
  },
});
