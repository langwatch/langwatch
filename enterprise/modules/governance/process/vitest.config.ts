import { fileURLToPath } from "node:url";

import { moduleVitestTestOptions } from "@langwatch/vitest-config";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Subpath first: the bare key also prefix-matches `/subpath`, and would
      // rewrite it to `index.ts/subpath` (ENOTDIR).
      "@langwatch/enterprise-governance-contract/ingestion-source-lifecycle": fileURLToPath(
        new URL(
          "../contract/src/features/ingestion/ingestion-source-lifecycle.events.ts",
          import.meta.url,
        ),
      ),
      "@langwatch/enterprise-governance-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: moduleVitestTestOptions({
    kind: "node",
    isolate: true,
    test: {
      exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
    },
  }),
});
