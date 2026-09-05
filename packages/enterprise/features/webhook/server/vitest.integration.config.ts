import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * This package's integration lane: every `*.integration.test.ts` under `src/`,
 * which `vitest.config.ts` excludes by the same suffix. The two configs are
 * complements, so a file cannot be in neither. The alias table is the unit
 * lane's, spelled out for the same reason it is spelled out there.
 *
 * WHAT IT NEEDS: Postgres, at `LANGWATCH_TEST_DATABASE_URL` or `DATABASE_URL`.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@langwatch\/enterprise-webhook-contract$/,
        replacement: fileURLToPath(new URL("../contract/src/index.ts", import.meta.url)),
      },
      {
        find: /^@langwatch\/eventing$/,
        replacement: fileURLToPath(new URL("../../../../eventing/src/index.ts", import.meta.url)),
      },
      {
        find: /^@langwatch\/handled-error$/,
        replacement: fileURLToPath(
          new URL("../../../../handled-error/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@langwatch\/observability$/,
        replacement: fileURLToPath(
          new URL("../../../../observability/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
