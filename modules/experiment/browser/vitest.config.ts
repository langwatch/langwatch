import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { configDefaults } from "vitest/config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // Several files mock the shared `@langwatch/trace-browser-kit` /
  // `@langwatch/langy-browser-kit` specifiers with different partial shapes
  // — isolate:false's default shared registry lets one file's mock leak.
  isolate: true,
  test: {
    exclude: [...configDefaults.exclude, "src/**/__tests__/**/*.browser.test.tsx"],
    setupFiles: ["./src/__tests__/setup.ts"],
    /**
     * The comparison table and the batch results grid drive real user events through
     * Chakra overlays and a virtualised table.
     */
    testTimeout: 30_000,
  },
});
