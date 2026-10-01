import { fileURLToPath } from "node:url";

import { moduleVitestTestOptions } from "@langwatch/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: moduleVitestTestOptions({
    kind: "jsdom",
    isolate: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  }),
  resolve: {
    alias: {
      "@langwatch/enterprise-governance-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/gateway-contract": fileURLToPath(
        new URL("../../../../modules/gateway/contract/src/index.ts", import.meta.url),
      ),
    },
  },
});
