import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
