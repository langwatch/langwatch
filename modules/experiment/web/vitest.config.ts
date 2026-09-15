import { configDefaults } from "vitest/config";
import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "jsdom",
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
