import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  test: {
    watch: false,
    testTimeout: 10_000,
  },
});
