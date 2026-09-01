import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@langwatch/authz-contract": fileURLToPath(
        new URL("../../authz/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/gateway-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/authz-web/surfaces/scope-picker": fileURLToPath(
        new URL("../../authz/web/src/surfaces/scope-picker/index.ts", import.meta.url),
      ),
      "@langwatch/model-provider-contract": fileURLToPath(
        new URL("../../model-provider/contract/src/index.ts", import.meta.url),
      ),
    },
  },
});
