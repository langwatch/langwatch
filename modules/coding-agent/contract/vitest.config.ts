import { defineConfig } from "vitest/config";
import { moduleVitestTestOptions } from "../../../packages/test-harness/src/vitest-config.ts";
export default defineConfig({
  test: moduleVitestTestOptions({ kind: "node", isolate: false }),
  resolve: {
    alias: {
      zod: new URL(
        "../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js",
        import.meta.url,
      ).pathname,
    },
  },
});
