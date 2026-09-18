import { moduleVitestTestOptions } from "@langwatch/vitest-config";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: moduleVitestTestOptions({
    kind: "node",
    test: {
      exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
    },
  }),
});
