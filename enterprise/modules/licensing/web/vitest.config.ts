import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { moduleVitestTestOptions } from "../../../../packages/test-harness/src/vitest-config.ts";

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/enterprise-licensing-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/authz-contract": fileURLToPath(
        new URL("../../../../modules/authz/contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: moduleVitestTestOptions({
    kind: "jsdom",
    isolate: true,
    test: {
      setupFiles: ["./src/__tests__/setup.ts"],
    },
  }),
});
