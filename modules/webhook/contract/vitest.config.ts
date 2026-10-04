import { fileURLToPath } from "node:url";

import { moduleVitestTestOptions } from "@langwatch/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: moduleVitestTestOptions({ kind: "node", isolate: false }),
  resolve: {
    alias: [
      {
        // Exact match: the package's subpath exports resolve on their own.
        find: /^@langwatch\/handled-error$/,
        replacement: fileURLToPath(
          new URL("../../../packages/handled-error/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
});
