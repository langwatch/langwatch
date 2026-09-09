import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
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
