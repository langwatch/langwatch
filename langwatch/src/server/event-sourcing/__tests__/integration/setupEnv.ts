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

if (process.env.CI && process.env.CI_REDIS_URL) {
  process.env.REDIS_URL = process.env.CI_REDIS_URL;
  // Must delete BUILD_TIME to allow redis.ts to create connections
  delete process.env.BUILD_TIME;
}

if (process.env.CI && process.env.CI_CLICKHOUSE_URL) {
  process.env.CLICKHOUSE_URL = process.env.CI_CLICKHOUSE_URL;
  process.env.TEST_CLICKHOUSE_URL = process.env.CI_CLICKHOUSE_URL;
}

// Disable license enforcement for integration tests
process.env.DISABLE_LICENSE_ENFORCEMENT = "true";
