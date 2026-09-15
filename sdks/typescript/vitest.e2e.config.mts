import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globalSetup: "./__tests__/e2e/setup/global-setup.ts",
    setupFiles: [
      "dotenv/config",
      "./test-setup.ts",
      "./__tests__/e2e/setup/msw-setup.ts",
      // Last, so the stack the global setup resolved beats anything a
      // dotenv file or the snapshot below put in the environment.
      "./__tests__/e2e/setup/stack-env.ts",
    ],
    include: ["**/*.e2e.test.ts"],
    passWithNoTests: true,
    env: {
      LANGWATCH_API_KEY: process.env.LANGWATCH_API_KEY ?? "",
      LANGWATCH_ENDPOINT: process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5610",
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // The shared stack launcher is a workspace-local dev package the SDK
      // never ships, so it is aliased rather than depended on.
      "@langwatch/e2e-stack": resolve(__dirname, "../../dev/tests/e2e-stack/src/index.ts"),
    },
  },
});
