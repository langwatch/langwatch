import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/enterprise-billing-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/enterprise-licensing-contract": fileURLToPath(
        new URL("../../licensing/contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: { environment: "node" },
});
