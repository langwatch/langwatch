import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { moduleVitestTestOptions } from "../../../../packages/test-harness/src/vitest-config.ts";

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/enterprise-governance-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: moduleVitestTestOptions({
    kind: "node",
    isolate: true,
    test: {
      exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
    },
  }),
});
