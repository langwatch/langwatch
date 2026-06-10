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

// Deterministic test values for the three AI Gateway secrets.
// The boot-validation logic enforces all-or-nothing: if any one of
// these is set, all three must be set (see start.ts). Without this
// block, the unit-test pepper-only fix in 50a4fea9b broke gateway
// init on every integration shard. Honor existing env values so
// localdev with real secrets isn't overridden. Matches the value
// used in virtualKey.service.unit.test.ts for the pepper.
process.env.LW_VIRTUAL_KEY_PEPPER =
  process.env.LW_VIRTUAL_KEY_PEPPER ?? "unit-test-pepper-32-bytes-exactly!";
process.env.LW_GATEWAY_INTERNAL_SECRET =
  process.env.LW_GATEWAY_INTERNAL_SECRET ??
  "unit-test-gateway-internal-secret-32b!";
process.env.LW_GATEWAY_JWT_SECRET =
  process.env.LW_GATEWAY_JWT_SECRET ??
  "unit-test-gateway-jwt-secret-32-bytes!";
// Disable the per-IP receiver rate-limit globally for integration tests.
// Tests that fire many POSTs from one IP (volume regression, dogfood
// smoke, auth-contract suite) would otherwise shed at the rate-limiter
// before reaching the receiver hot path. Tests that specifically
// exercise the rate-limiter override this back to "0" inside their own
// beforeAll. Spec:
// specs/ai-gateway/governance/receiver-auth-rate-limit.feature.
process.env.LW_INGEST_RATE_LIMIT_DISABLED =
  process.env.LW_INGEST_RATE_LIMIT_DISABLED ?? "1";

if (process.env.CI && process.env.CI_REDIS_URL) {
  process.env.REDIS_URL = process.env.CI_REDIS_URL;
  // Must delete BUILD_TIME to allow redis.ts to create connections
  delete process.env.BUILD_TIME;
}

if (process.env.CI && process.env.CI_CLICKHOUSE_URL) {
  process.env.CLICKHOUSE_URL = process.env.CI_CLICKHOUSE_URL;
  process.env.TEST_CLICKHOUSE_URL = process.env.CI_CLICKHOUSE_URL;
}
