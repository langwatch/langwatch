import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
