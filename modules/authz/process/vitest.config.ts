import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { configDefaults } from "vitest/config";

import { repoScans } from "./vitest.repo.config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  test: {
    watch: false,
    testTimeout: 10000,
    include: ["src/**/*.test.ts"],
    // The integration lane is its own config, because those suites need a
    // real Postgres and this one must stay runnable without any datastore.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts", ...repoScans],
  },
});
