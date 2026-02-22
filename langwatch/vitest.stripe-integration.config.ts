import dotenv from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

dotenv.config({ path: ".env" });

export default defineConfig({
  test: {
    include: [
      "saas-src/__tests__/**/*.integration.{test,spec}.?(c|m)[jt]s?(x)",
    ],
    exclude: [...configDefaults.exclude, ".next/**/*", ".next-saas/**/*"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "~/": join(__dirname, "./src/"),
      "@langwatch-oss/": join(__dirname, "./"),
    },
  },
});
