import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/audit-log-contract": fileURLToPath(
        new URL("../../../../modules/audit-log/contract/src/index.ts", import.meta.url),
      ),
    },
  },
});
