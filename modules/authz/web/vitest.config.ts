import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "jsdom",
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // The roles screen drives a Chakra dialog with a two-hundred-checkbox
    // permission matrix inside it; under a fully loaded worker pool that clears
    // the default budget while passing comfortably alone. The same budget
    // gateway-web, agent-web and model-provider-web took.
    testTimeout: 30_000,
  },
});
