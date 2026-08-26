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

import { TEST_PUBLIC_KEY } from "../../../../../../../packages/enterprise/features/licensing/server/src/fixtures/license-keys.fixture";
import { assertSerialWorkerSlot } from "../../../../test-utils/integrationFileConcurrency";

// This module runs once per worker, which is where a second worker becomes
// observable at all. Files sharing a ClickHouse schema and a Redis instance
// only hold together while they run one at a time, so a worker slot that
// should not exist fails here rather than surfacing as a suite reading another
// suite's half-applied migration.
assertSerialWorkerSlot(process.env);

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
  process.env.LW_GATEWAY_INTERNAL_SECRET ?? "unit-test-gateway-internal-secret-32b!";
process.env.LW_GATEWAY_JWT_SECRET =
  process.env.LW_GATEWAY_JWT_SECRET ?? "unit-test-gateway-jwt-secret-32-bytes!";
// Disable the per-IP receiver rate-limit globally for integration tests.
// Tests that fire many POSTs from one IP (volume regression, dogfood
// smoke, auth-contract suite) would otherwise shed at the rate-limiter
// before reaching the receiver hot path. Tests that specifically
// exercise the rate-limiter override this back to "0" inside their own
// beforeAll. Spec:
// specs/ai-gateway/governance/receiver-auth-rate-limit.feature.
process.env.LW_INGEST_RATE_LIMIT_DISABLED =
  process.env.LW_INGEST_RATE_LIMIT_DISABLED ?? "1";

// Deterministic encryption key so suites that store model-provider
// credentials (encrypted at rest) can run in CI. Must be a 32-byte hex
// string — the NEXTAUTH_SECRET fallback in utils/encryption.ts is not
// hex in CI, so without this the encrypt() call throws. Honors an
// existing value so localdev keeps its real secret.
process.env.CREDENTIALS_SECRET =
  process.env.CREDENTIALS_SECRET ??
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

if (process.env.CI && process.env.CI_REDIS_URL) {
  process.env.REDIS_URL = process.env.CI_REDIS_URL;
  // Must delete BUILD_TIME to allow redis.ts to create connections
  delete process.env.BUILD_TIME;
}

if (process.env.CI && process.env.CI_CLICKHOUSE_URL) {
  process.env.CLICKHOUSE_URL = process.env.CI_CLICKHOUSE_URL;
  process.env.TEST_CLICKHOUSE_URL = process.env.CI_CLICKHOUSE_URL;
}

// Give each worker its own Redis logical database.
//
// The integration suite runs one file at a time, and Redis is one of the
// reasons: the queue derives its keys from the queue name alone, so two workers
// building the same pipeline share a queue and consume each other's jobs. The
// ClickHouse fixtures carry per-suite tenant ids, which keeps their rows
// apart, though not the schema they share.
//
// Redis ships 16 logical databases and `select` isolates them completely, so
// pointing worker N at database N removes the contention without a second
// container or a rewrite of the suites.
//
// Off unless asked for: this only makes sense alongside fileParallelism, and
// a single-worker run should keep using whichever database the URL already
// names. `flushdb` is therefore per worker; a `flushall` would still cross
// the boundary, which is why the suite has none left.
if (process.env.VITEST_ISOLATE_WORKER_REDIS === "1" && process.env.REDIS_URL) {
  const workerId = Number(
    process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? "1",
  );
  if (Number.isFinite(workerId)) {
    const url = new URL(process.env.REDIS_URL);
    url.pathname = `/${workerId % 16}`;
    process.env.REDIS_URL = url.toString();
  }
}
