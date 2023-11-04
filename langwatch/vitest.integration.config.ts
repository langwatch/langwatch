import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.integration.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [...configDefaults.exclude],
  },
  resolve: {
    alias: {
      "~/": join(__dirname, "./src/"),
    },
  },
});
