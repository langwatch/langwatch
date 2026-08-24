import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/enterprise-webhooks-contract": source("../contract/src/index.ts"),
      "@langwatch/eventing": source("../../../../eventing/src/index.ts"),
      "@langwatch/handled-error": source("../../../../handled-error/src/index.ts"),
      "@langwatch/observability": source("../../../../observability/src/index.ts"),
    },
  },
});
