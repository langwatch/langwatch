import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  isolate: false,
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
