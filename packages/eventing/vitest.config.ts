import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30_000,
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
