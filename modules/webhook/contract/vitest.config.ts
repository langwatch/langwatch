import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { moduleVitestTestOptions } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineConfig({
  test: moduleVitestTestOptions({ kind: "node", isolate: false }),
  resolve: {
    alias: {
      "@langwatch/handled-error": fileURLToPath(
        new URL("../../../packages/handled-error/src/index.ts", import.meta.url),
      ),
    },
  },
});
