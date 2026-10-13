import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  test: { include: ["src/**/*.test.ts"] },
});
