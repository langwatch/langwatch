import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: {
    watch: false,
    testTimeout: 10000,
    include: ["src/**/*.test.ts"],
  },
});
