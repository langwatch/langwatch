import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` under `src/`, excluded from the
 * unit lane. Needs Postgres, at `DATABASE_URL` — the ingestion template,
 * department and AI-tool-catalog suites assert against real rows.
 */
export default defineConfig({
  test: {
    fsModuleCache: true,
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
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
});
