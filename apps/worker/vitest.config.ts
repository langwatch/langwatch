import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: true,
    watch: false,
    testTimeout: 10_000,
    // The complement of `vitest.integration.config.ts`, which owns every
    // `*.integration.test.ts` under src/. A file cannot be in neither lane.
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.integration.test.ts"],
  },
});
