import { defineModuleVitestConfig } from "../test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "preview/**/*.test.ts"],
  },
});
