import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { configDefaults } from "vitest/config";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  // Its fleet gauges are declared on import, and another file's deactivateMetrics()
  // drops them for good once the module is shared, so a test reading them needs its own.
  alsoIsolate: ["src/process-manager/metrics.ts"],
  test: {
    environment: "node",
    testTimeout: 30_000,
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
