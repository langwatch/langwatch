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
      "@langwatch/coding-agent-contract": fileURLToPath(
        new URL("../../coding-agent/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-web/activity": fileURLToPath(
        new URL("../../coding-agent/web/src/activity.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-web": fileURLToPath(
        new URL("../../coding-agent/web/src/index.ts", import.meta.url),
      ),
      "@langwatch/enterprise-governance-contract": fileURLToPath(
        new URL("../../../enterprise/features/governance/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/gateway-web/surfaces/budget-overview": fileURLToPath(
        new URL("../../gateway/web/src/surfaces/budget-overview/index.ts", import.meta.url),
      ),
      "@langwatch/model-provider-contract": fileURLToPath(
        new URL("../../model-provider/contract/src/index.ts", import.meta.url),
      ),
    },
  },
});
