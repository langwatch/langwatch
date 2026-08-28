import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/enterprise-licensing-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
    },
  },
});
