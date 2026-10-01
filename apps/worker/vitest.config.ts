import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  test: {
    fsModuleCache: true,
    watch: false,
    // The app is a main.ts and a config.ts; its unit lane may hold no file.
    passWithNoTests: true,
    testTimeout: 10_000,
    // The complement of `vitest.integration.config.ts`, which owns every
    // `*.integration.test.ts` under src/. A file cannot be in neither lane.
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.integration.test.ts"],
  },
});
