import { config } from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

config({ path: ["../../.env", ".env"] });

export default defineConfig({
  test: {
    setupFiles: ["./test-setup.ts"],
    include: ["**/*.stress.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [...configDefaults.exclude, ".next/**/*", ".next-saas/**/*"],
    testTimeout: 300_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "~/generated/prisma/client": join(
        __dirname,
        "../../packages/prisma-client/src/generated/client.ts",
      ),
      "~/": join(__dirname, "./src/"),
      "@ee/": join(__dirname, "./ee/"),
      "@app/": join(__dirname, "./src/server/app-layer/"),
    },
  },
});
