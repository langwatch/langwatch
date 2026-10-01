import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.integration.test.ts"],
  test: {
    watch: false,
    testTimeout: 10_000,
  },
});
