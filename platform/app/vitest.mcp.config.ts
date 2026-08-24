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
      "~/generated/prisma/client": join(
        __dirname,
        "../../packages/prisma-client/src/generated/client.ts",
      ),
      "~/": join(__dirname, "./src/"),
      "@ee/": join(__dirname, "./ee/"),
      "@app/": join(__dirname, "./src/server/app-layer/"),
    },
  },
});
