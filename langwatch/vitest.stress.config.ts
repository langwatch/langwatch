import { config } from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

config();

export default defineConfig({
  test: {
    setupFiles: ["./test-setup.stress.ts"],
    include: ["**/*.stress.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [...configDefaults.exclude, ".next/**/*", ".next-saas/**/*"],
    testTimeout: 300_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "~/": join(__dirname, "./src/"),
      "@app/": join(__dirname, "./src/server/app-layer/"),
      "@injected-dependencies.client": join(
        __dirname,
        "./src/injection/injection.client.ts",
      ),
      "@injected-dependencies.server": join(
        __dirname,
        "./src/injection/injection.server.ts",
      ),
    },
  },
});
