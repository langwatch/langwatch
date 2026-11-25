import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { configDefaults } from "vitest/config";

import { repoScans } from "./vitest.repo.config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts", ...repoScans],
  },
});
