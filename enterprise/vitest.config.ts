import { defineModuleVitestConfig } from "../packages/test-harness/src/vitest-config.ts";

/** Includes both tests/** (old) and src/** (new) layouts during migration. */

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
