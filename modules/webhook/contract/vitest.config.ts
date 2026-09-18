import { fileURLToPath } from "node:url";

import { moduleVitestTestOptions } from "@langwatch/vitest-config";
import { defineConfig } from "vitest/config";

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
