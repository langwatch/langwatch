import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/handled-error": fileURLToPath(
        new URL("../../../../handled-error/src/index.ts", import.meta.url),
      ),
    },
  },
});
