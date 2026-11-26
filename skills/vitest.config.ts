import { defineModuleVitestConfig } from "@langwatch/vitest-config";

// Unit lane. The scenarios drive live Claude Code sessions and run only
// through `pnpm test:suite`, on vitest.scenario.config.ts.
export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  // recipes/*/templates and their _compiled copies hold test files users copy into
  // their own repos.
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/*.scenario.test.ts",
    "recipes/*/templates/**",
    "_compiled/**",
  ],
  test: {
    globalSetup: ["./_tests/helpers/temp-workdir-teardown.ts"],
  },
});
