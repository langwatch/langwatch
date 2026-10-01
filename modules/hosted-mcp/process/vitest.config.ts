import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { configDefaults } from "vitest/config";

/**
 * The unit lane, split by DEPENDENCY rather than by file name: the two suites
 * named below need a real Redis, and every other file here needs none.
 */

export default defineModuleVitestConfig({
  kind: "node",
  // The request-logging suite replaces @langwatch/observability with vi.mock,
  // which a registry shared with earlier files has already loaded for real.
  isolate: true,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [
      ...configDefaults.exclude,
      "**/hosted-mcp.sse-relay.integration.test.ts",
      "**/hosted-mcp.streamable-reconnect.integration.test.ts",
    ],
  },
});
