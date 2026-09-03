import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /**
     * The real-browser lane is excluded, exactly as `platform/app` excluded it.
     * `evaluator-form-zod-source.browser.test.tsx` drives a live form through
     * `vitest/browser`, which jsdom cannot host; that application ran it from a
     * separate `vitest.browser.config.ts` CI never ran, and the analytics and
     * traces families each recorded the same about their own.
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
