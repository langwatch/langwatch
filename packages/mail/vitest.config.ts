import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  // Its suites replace the transports with vi.mock, and a registry shared with
  // an earlier file sends through the real ones instead.
  isolate: true,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "preview/**/*.test.ts"],
  },
});
