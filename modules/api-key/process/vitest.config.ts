import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
});
