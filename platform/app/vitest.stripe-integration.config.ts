import dotenv from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

dotenv.config({ path: ["../../.env", ".env"] });

export default defineConfig({
  test: {
    include: ["ee/**/*.integration.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [...configDefaults.exclude, ".next/**/*", ".next-saas/**/*"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "~/generated/prisma/client": join(
        __dirname,
        "../../packages/prisma-client/src/generated/client.ts",
      ),
      "~/": join(__dirname, "./src/"),
    },
  },
});
