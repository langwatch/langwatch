import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { moduleVitestTestOptions } from "../../../packages/test-harness/src/vitest-config.ts";

/**
 * Anchored aliases, not object form: Vite's object alias is a PREFIX
 * replacement, so a subpath import would resolve to `…/index.ts/metrics`
 * and die on `ENOTDIR`. Spelled out since `test-harness` reads this table statically too.
 */

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@langwatch\/webhook-contract$/,
        replacement: fileURLToPath(new URL("../contract/src/index.ts", import.meta.url)),
      },
      {
        find: /^@langwatch\/eventing$/,
        replacement: fileURLToPath(
          new URL("../../../packages/eventing/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@langwatch\/handled-error$/,
        replacement: fileURLToPath(
          new URL("../../../packages/handled-error/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@langwatch\/observability$/,
        replacement: fileURLToPath(
          new URL("../../../packages/observability/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: moduleVitestTestOptions({
    kind: "node",
    isolate: false,
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      // The integration lane is its own config, because that suite needs a real
      // Postgres and this one must stay runnable without any datastore.
      exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
    },
  }),
});
