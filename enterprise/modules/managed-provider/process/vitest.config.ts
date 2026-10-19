import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  /**
   * The credentials channel mocks `@aws-sdk/client-sts` and every other file
   * reaches it through the package entry: sharing a registry lets the loser of
   * that race sign a real request.
   */
  isolate: true,
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
