import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  test: { include: ["src/**/*.test.ts"] },
});
