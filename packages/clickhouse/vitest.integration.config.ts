import { config } from "dotenv";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// This package has no `.env` of its own — `LANGWATCH_TEST_CLICKHOUSE_URL`
// lives in the application's, same as every other consumer of the native
// no-docker test mode (CLAUDE.md, "Running with no container runtime").
config({ path: join(__dirname, "../../.env") });

export default defineConfig({
  test: {
    globalSetup: ["./src/__tests__/integration/globalSetup.ts"],
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 60_000, // ClickHouse container / connection startup
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    // Sequential files, forked processes: the app's own
    // vitest.integration.config.ts guardrail (CLAUDE.md, "Hand-rolling a
    // throwaway vitest.*.config.ts") — a bare config would default to the
    // `forks` pool at `availableParallelism - 1` workers instead of one.
    fileParallelism: false,
    pool: "forks",
  },
});
