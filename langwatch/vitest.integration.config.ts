import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test-setup.ts"],
    include: ["**/*.integration.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [...configDefaults.exclude],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      "~/": join(__dirname, "./src/"),
    },
  },
});
