import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { moduleVitestTestOptions } from "../../../../packages/test-harness/src/vitest-config.ts";

export default defineConfig({
  test: moduleVitestTestOptions({ kind: "jsdom", isolate: true }),
  resolve: {
    alias: {
      "@langwatch/enterprise-governance-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
    },
  },
});
