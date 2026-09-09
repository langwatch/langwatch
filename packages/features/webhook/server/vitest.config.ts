import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Anchored aliases, not object form: Vite's object alias is a PREFIX
 * replacement, so a subpath import would resolve to `…/index.ts/metrics`
 * and die on `ENOTDIR`. Spelled out since `test-harness` reads this table statically too.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The integration lane is its own config, because that suite needs a real
    // Postgres and this one must stay runnable without any datastore.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
  resolve: {
    alias: [
      {
        find: /^@langwatch\/webhook-contract$/,
        replacement: fileURLToPath(new URL("../contract/src/index.ts", import.meta.url)),
      },
      {
        find: /^@langwatch\/eventing$/,
        replacement: fileURLToPath(new URL("../../../eventing/src/index.ts", import.meta.url)),
      },
      {
        find: /^@langwatch\/handled-error$/,
        replacement: fileURLToPath(
          new URL("../../../handled-error/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@langwatch\/observability$/,
        replacement: fileURLToPath(
          new URL("../../../observability/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
});
