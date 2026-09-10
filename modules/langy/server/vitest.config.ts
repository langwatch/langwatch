import { configDefaults, defineConfig } from "vitest/config";
import { moduleVitestTestOptions } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineConfig({
  test: moduleVitestTestOptions({
    kind: "node",
    isolate: true,
    test: {
      exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
    },
  }),
});
