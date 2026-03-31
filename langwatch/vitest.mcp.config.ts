/**
 * Vitest config for MCP integration tests.
 *
 * These tests mock Prisma and Redis, so they do not need Docker containers.
 * This config skips the testcontainer-based globalSetup used by the main
 * integration test config.
 */
import { config } from "dotenv";
import { join } from "path";
import { defineConfig } from "vitest/config";

config();

export default defineConfig({
  test: {
    watch: false,
    include: ["src/mcp/**/*.integration.{test,spec}.?(c|m)[jt]s?(x)"],
    testTimeout: 30_000,
    env: {
      BUILD_TIME: "1",
      SKIP_ENV_VALIDATION: "1",
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "~/": join(__dirname, "./src/"),
      "@app/": join(__dirname, "./src/server/app-layer/"),
      "@langwatch/mcp-server": join(__dirname, "../mcp-server/src"),
      "@injected-dependencies.client": join(
        __dirname,
        "./src/injection/injection.client.ts",
      ),
      "@injected-dependencies.server": join(
        __dirname,
        "./src/injection/injection.server.ts",
      ),
    },
  },
});
