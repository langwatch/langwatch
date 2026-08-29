import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "src/**/__tests__/**/*.browser.test.tsx"],
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
