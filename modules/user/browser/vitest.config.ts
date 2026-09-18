import { fileURLToPath } from "node:url";

import { moduleVitestTestOptions } from "@langwatch/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/authz-contract": fileURLToPath(
        new URL("../../authz/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-contract": fileURLToPath(
        new URL("../../coding-agent/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-browser/surfaces/activity": fileURLToPath(
        new URL("../../coding-agent/browser/src/activity.ts", import.meta.url),
      ),
      // Ahead of the bare package alias below, which is a PREFIX match and
      // would otherwise rewrite this subpath to `…/src/index.ts/surfaces/…`.
      "@langwatch/coding-agent-browser/surfaces/agent-identity": fileURLToPath(
        new URL("../../coding-agent/browser/src/agent-identity.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-browser/surfaces/agent-metrics": fileURLToPath(
        new URL("../../coding-agent/browser/src/agent-metrics.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-browser/surfaces/agent-traces": fileURLToPath(
        new URL("../../coding-agent/browser/src/agent-traces.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-browser/surfaces/pull-requests": fileURLToPath(
        new URL("../../coding-agent/browser/src/pull-requests.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-browser/surfaces/session-table": fileURLToPath(
        new URL("../../coding-agent/browser/src/session-table.ts", import.meta.url),
      ),
      "@langwatch/coding-agent-browser": fileURLToPath(
        new URL("../../coding-agent/browser/src/index.ts", import.meta.url),
      ),
      "@langwatch/enterprise-governance-contract": fileURLToPath(
        new URL("../../../enterprise/modules/governance/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/gateway-contract": fileURLToPath(
        new URL("../../gateway/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/model-provider-contract": fileURLToPath(
        new URL("../../model-provider/contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: moduleVitestTestOptions({
    kind: "jsdom",
    // Several suites here mock modules, and with isolation off those mocks
    // leaked across files: 2 runs in 5 failed on a cross-file collision.
    isolate: true,
    test: {
      setupFiles: ["./vitest.setup.ts"],
    },
  }),
});
