import { configDefaults, defineConfig } from "vitest/config";

/**
 * The unit lane, split by DEPENDENCY rather than by file name: the two suites
 * named below need a real Redis, and every other file here needs none.
 */
export default defineConfig({
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
