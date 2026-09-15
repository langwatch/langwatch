import { defineModuleVitestConfig } from "../../../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: {
    testTimeout: 300_000, // scenario runs include an LLM judge + user simulator
    hookTimeout: 30_000,
  },
});
