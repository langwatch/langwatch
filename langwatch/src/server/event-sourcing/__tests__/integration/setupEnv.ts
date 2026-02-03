/**
 * CI Environment Setup - MUST be imported FIRST in vitest.integration.config.ts
 *
 * This file sets environment variables for CI before any other modules are loaded.
 * It handles the mapping from CI-specific env vars to application-expected env vars.
 *
 * In CI (GitHub Actions):
 * - CI_REDIS_URL is set to the Redis service container URL
 * - CI_CLICKHOUSE_URL is set to the ClickHouse service container URL
 * - BUILD_TIME=true prevents Redis connections (must be deleted)
 *
 * This file runs as a side-effect import, modifying process.env before
 * any application code (like redis.ts) is loaded.
 */

import { TEST_PUBLIC_KEY } from "../../../../../ee/licensing/__tests__/fixtures/testKeys";

// Set TEST_PUBLIC_KEY for license verification in integration tests.
// This allows test licenses (signed with TEST_PRIVATE_KEY) to validate correctly.
process.env.LANGWATCH_LICENSE_PUBLIC_KEY = TEST_PUBLIC_KEY;

if (process.env.CI && process.env.CI_REDIS_URL) {
  process.env.REDIS_URL = process.env.CI_REDIS_URL;
  // Must delete BUILD_TIME to allow redis.ts to create connections
  delete process.env.BUILD_TIME;
}

if (process.env.CI && process.env.CI_CLICKHOUSE_URL) {
  process.env.CLICKHOUSE_URL = process.env.CI_CLICKHOUSE_URL;
  process.env.TEST_CLICKHOUSE_URL = process.env.CI_CLICKHOUSE_URL;
}
