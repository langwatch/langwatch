import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
