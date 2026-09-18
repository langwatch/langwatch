import { fileURLToPath } from "node:url";

import { moduleVitestTestOptions } from "@langwatch/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: moduleVitestTestOptions({ kind: "node", isolate: false }),
  resolve: {
    alias: {
      "@langwatch/audit-log-contract": fileURLToPath(
        new URL("../../../../modules/audit-log/contract/src/index.ts", import.meta.url),
      ),
    },
  },
});
