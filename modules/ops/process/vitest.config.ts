import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { configDefaults } from "vitest/config";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  // They read eventing's pm_* gauges, declared on import; another file's deactivateMetrics()
  // drops them for good once the module is shared (see eventing's vitest config).
  alsoIsolate: [
    "src/app/__tests__/ops-installation.unit.test.ts",
    "src/services/__tests__/process-fleet-collection.service.unit.test.ts",
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
