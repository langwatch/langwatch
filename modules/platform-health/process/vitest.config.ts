import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  // A test mocks @langwatch/observability; isolation keeps the mock in its file (testing-speed.md).
  isolate: true,
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
