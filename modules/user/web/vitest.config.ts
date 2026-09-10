import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { moduleVitestTestOptions } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/authz-contract": fileURLToPath(
        new URL("../../authz/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-contract": fileURLToPath(
        new URL("../../coding-agent/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-web/surfaces/activity": fileURLToPath(
        new URL("../../coding-agent/web/src/activity.ts", import.meta.url),
      ),
      // Ahead of the bare package alias below, which is a PREFIX match and
      // would otherwise rewrite this subpath to `…/src/index.ts/surfaces/…`.
      "@langwatch/coding-agent-web/surfaces/agent-identity": fileURLToPath(
        new URL("../../coding-agent/web/src/agent-identity.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-web/surfaces/agent-metrics": fileURLToPath(
        new URL("../../coding-agent/web/src/agent-metrics.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-web/surfaces/agent-traces": fileURLToPath(
        new URL("../../coding-agent/web/src/agent-traces.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-web/surfaces/pull-requests": fileURLToPath(
        new URL("../../coding-agent/web/src/pull-requests.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-web/surfaces/session-table": fileURLToPath(
        new URL("../../coding-agent/web/src/session-table.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-web": fileURLToPath(
        new URL("../../coding-agent/web/src/index.ts", import.meta.url),
      ),
      "@langwatch/enterprise-governance-contract": fileURLToPath(
        new URL("../../../enterprise/modules/governance/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/gateway-web/surfaces/budget-overview": fileURLToPath(
        new URL("../../gateway/web/src/ui/sections/budget-overview/index.ts", import.meta.url),
      ),
      "@langwatch/model-provider-contract": fileURLToPath(
        new URL("../../model-provider/contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: moduleVitestTestOptions({
    kind: "jsdom",
    isolate: true,
    test: {
      setupFiles: ["./vitest.setup.ts"],
    },
  }),
});
