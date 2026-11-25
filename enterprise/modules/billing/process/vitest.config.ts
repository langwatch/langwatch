import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { configDefaults } from "vitest/config";

export default defineModuleVitestConfig({
  kind: "node",
  test: {
    environment: "node",
    isolate: true,
    include: ["src/**/*.test.ts"],
    // The integration lane is its own config, because that suite needs a real
    // Postgres and this one must stay runnable without any datastore.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
