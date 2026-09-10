import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "jsdom",
  isolate: true,
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
