import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  test: {
    fsModuleCache: true,
    watch: false,
    testTimeout: 10_000,
  },
});
