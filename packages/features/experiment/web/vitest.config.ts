import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "tests/batch-results/**/*.browser.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
  },
});
