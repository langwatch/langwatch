import { defineModuleVitestConfig } from "@langwatch/vitest-config";

// Unit lane. The scenarios drive live Claude Code sessions and run only
// through `pnpm test:suite`, on vitest.scenario.config.ts.
export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  exclude: ["**/node_modules/**", "**/dist/**", "**/*.scenario.test.ts"],
  test: {
    globalSetup: ["./_tests/helpers/temp-workdir-teardown.ts"],
  },
});
