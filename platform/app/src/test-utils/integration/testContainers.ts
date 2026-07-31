import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import IORedis, { type Redis } from "ioredis";
import {
  type ClickHouseClientResolver,
  type TenantClickHouseClient,
  tenantClickHouseClient,
} from "~/server/app-layer/clients/clickhouse/tenant-client";
import {
  type AppClickHouseClient,
  createAppClickHouseClient,
} from "~/server/app-layer/clients/clickhouseClient.factory";
import { migrateUp } from "~/server/clickhouse/goose";
import { toError } from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:event-sourcing:test-containers");

let clickHouseClient: ClickHouseClient | null = null;
let redisConnection: Redis | null = null;
/**
 * The url the driver client was built from, database included. Distinct from
 * the `clickHouseUrl` `startTestContainers` returns, which on the CI branch
 * carries no database path.
 */
let qualifiedClickHouseUrl: string | null = null;
let testAppClickHouseClient: AppClickHouseClient | null = null;
const migratedUrls = new Set<string>();

/**
 * Checks if we're running in CI with service containers (GitHub Actions).
 * In CI, we use service containers instead of testcontainers.
 */
function isUsingServiceContainers(): boolean {
  return !!(
    process.env.CI_CLICKHOUSE_URL &&
    process.env.CI_REDIS_URL &&
    process.env.CI
  );
}

/**
 * Checks if containers were started by globalSetup.
 * When globalSetup starts containers, it writes connection URLs to a temp file.
 */
function isUsingGlobalSetupContainers(): boolean {
  return !!(process.env.TEST_CLICKHOUSE_URL && process.env.REDIS_URL);
}

/**
 * Connects to ClickHouse and Redis containers for integration tests.
 * Should be called before running integration tests.
 *
 * Container sources (in priority order):
 * 1. CI service containers (GitHub Actions) - via CI_CLICKHOUSE_URL and CI_REDIS_URL
 * 2. Global setup containers (started by globalSetup.ts) - via TEST_CLICKHOUSE_URL and REDIS_URL
 *
 * Throws an error if no containers are available.
 */
export async function startTestContainers(): Promise<{
  clickHouseClient: ClickHouseClient;
  redisConnection: Redis;
  clickHouseUrl: string;
  redisUrl: string;
}> {
  if (process.env.NODE_ENV !== "test") {
    logger.fatal(
      "startTestContainers should only be called in test environment",
    );
  }

  // If using service containers (CI), connect to them directly
  // Note: CI service containers must have `local_primary` storage policy pre-configured
  if (isUsingServiceContainers()) {
    const clickHouseUrl = process.env.CI_CLICKHOUSE_URL!;
    const redisUrl = process.env.CI_REDIS_URL!;

    if (!redisConnection) {
      redisConnection = new IORedis(redisUrl, {
        maxRetriesPerRequest: 0,
        offlineQueue: true,
      });
    }

    // Run goose migrations once per URL per process — subsequent test files in the
    // same shard skip this (migrations are already applied and goose spawnSync is blocking).
    if (!migratedUrls.has(clickHouseUrl)) {
      await initializeClickHouseSchema(clickHouseUrl, TEST_DATABASE);
      migratedUrls.add(clickHouseUrl);
    }

    // Create client with the database in the URL path
    const urlWithDatabase = new URL(clickHouseUrl);
    urlWithDatabase.pathname = `/${TEST_DATABASE}`;

    qualifiedClickHouseUrl = urlWithDatabase.toString();
    clickHouseClient = createClient({
      url: urlWithDatabase,
      clickhouse_settings: {
        date_time_input_format: "best_effort",
      },
    });

    return {
      clickHouseClient,
      redisConnection,
      clickHouseUrl,
      redisUrl,
    };
  }

  // If using global setup containers (shared across workers), connect to them
  if (isUsingGlobalSetupContainers()) {
    const clickHouseUrl = process.env.TEST_CLICKHOUSE_URL!;
    const redisUrl = process.env.REDIS_URL!;

    if (!redisConnection) {
      redisConnection = new IORedis(redisUrl, {
        maxRetriesPerRequest: 0,
        offlineQueue: true,
      });
    }

    // Don't run migrations - globalSetup already did that
    // globalSetup provides URL with correct database already in pathname
    qualifiedClickHouseUrl = clickHouseUrl;
    if (!clickHouseClient) {
      clickHouseClient = createClient({
        url: new URL(clickHouseUrl),
        clickhouse_settings: {
          date_time_input_format: "best_effort",
        },
      });
    }

    return {
      clickHouseClient,
      redisConnection,
      clickHouseUrl,
      redisUrl,
    };
  }

  // No containers available - fail fast with helpful error message
  throw new Error(
    "No test containers available. Either:\n" +
      "  - Set CI_CLICKHOUSE_URL, CI_REDIS_URL, and CI env vars (for CI)\n" +
      "  - Run tests via vitest which uses globalSetup.ts to start containers\n" +
      "  - Set TEST_CLICKHOUSE_URL and REDIS_URL manually",
  );
}

/**
 * Closes connections to test containers.
 * Should be called after integration tests complete.
 *
 * Note: Only closes connections - containers are managed by globalSetup.ts (local)
 * or CI service containers (GitHub Actions).
 */
export async function stopTestContainers(): Promise<void> {
  const errors: Error[] = [];

  // Close ClickHouse client. Bounded by a small timeout so a wedged
  // HTTP keep-alive pool can't hold the shard's afterAll forever.
  // Closed before the driver client so its pools release with the rest, and
  // reset so the next file's `startTestContainers` rebuilds against whatever
  // url that run resolves.
  if (testAppClickHouseClient) {
    const app = testAppClickHouseClient;
    testAppClickHouseClient = null;
    qualifiedClickHouseUrl = null;
    try {
      await Promise.race([
        app.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch (e) {
      errors.push(toError(e));
    }
  }

  if (clickHouseClient) {
    const client = clickHouseClient;
    clickHouseClient = null;
    try {
      await Promise.race([
        client.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch (e) {
      errors.push(toError(e));
    }
  }

  // Close Redis connection. quit() waits for pending replies, so a test
  // that left a BRPOP/SUBSCRIBE on the shared test connection (BullMQ
  // workers, groupQueue dispatchers) wedges the entire shard's teardown
  // and stalls vitest's reporter. Race a quick quit() against a short
  // timeout, then forcibly disconnect so the worker can exit either way.
  if (redisConnection) {
    const conn = redisConnection;
    redisConnection = null;
    try {
      await Promise.race([
        conn.quit().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch (e) {
      errors.push(toError(e));
    }
    try {
      conn.disconnect();
    } catch {
      // already disconnected
    }
  }

  if (errors.length > 0) {
    logger.warn(
      { errors: errors.map((e) => e.message) },
      "Errors during connection cleanup",
    );
  }
}

/**
 * Gets the current ClickHouse client if containers are started.
 */
export function getTestClickHouseClient(): ClickHouseClient | null {
  return clickHouseClient;
}

/**
 * A {@link TenantClickHouseClient} over the test container, for the
 * integration tests whose subject now takes one.
 *
 * Here rather than copied into each test file for the obvious reason and one
 * less obvious one. `startTestContainers` returns `clickHouseUrl` **without
 * the database in its path** on the CI branch — it grafts the database on
 * separately when building the driver client — so a test that built its own
 * client from that returned url would silently run against `default` under CI
 * and against the test database locally, which is the kind of difference that
 * shows up as one unreproducible red build. {@link qualifiedClickHouseUrl}
 * is the url the driver client was actually built from, so both branches agree.
 *
 * The tenant is a parameter because it is the thing under test: a repository
 * bound to the wrong tenant is exactly the bug these suites exist to catch.
 */
export function getTestTenantClickHouseClient(
  tenantId: string,
): TenantClickHouseClient {
  if (!qualifiedClickHouseUrl) {
    throw new Error(
      "startTestContainers() must run before getTestTenantClickHouseClient()",
    );
  }

  testAppClickHouseClient ??= createAppClickHouseClient({
    url: qualifiedClickHouseUrl,
  });

  return tenantClickHouseClient({
    client: testAppClickHouseClient.resolveClient(tenantId),
    tenantId,
  });
}

/**
 * A resolver over the test container, for subjects that take a
 * `ClickHouseClientResolver` rather than a bound client.
 */
export function getTestClickHouseClientResolver(): ClickHouseClientResolver {
  return async (tenantId: string) => getTestTenantClickHouseClient(tenantId);
}

/**
 * Gets the current Redis connection if containers are started.
 */
export function getTestRedisConnection(): Redis | null {
  return redisConnection;
}

const TEST_DATABASE = "test_langwatch";

/**
 * Initializes ClickHouse schema using goose migrations.
 * Runs the same migrations as production to ensure schema parity.
 *
 * @param connectionUrl - The ClickHouse connection URL (without database)
 * @param database - The database name to create and migrate
 */
async function initializeClickHouseSchema(
  connectionUrl: string,
  database?: string,
): Promise<void> {
  await migrateUp({
    connectionUrl,
    database,
    verbose: true,
  });
}

/**
 * Cleans up test data from ClickHouse tables and Redis queues.
 * Useful for test isolation.
 * Uses TRUNCATE for synchronous cleanup (faster and more reliable than DELETE).
 */
export async function cleanupTestData(tenantId?: string): Promise<void> {
  // Clean up Redis queues (BullMQ stores queues in Redis)
  // When tenantId is provided, queues should be closed before cleanup is called
  // Only flush all Redis data when doing full cleanup (no tenantId)
  if (redisConnection && !tenantId) {
    // Full cleanup - flush the test redis database. flushdb, NOT flushall:
    // in native local-services mode the redis instance is shared with the
    // dev stack and only the numbered test db belongs to the suite.
    await redisConnection.flushdb();
  }
  // For tenant-specific cleanup, we don't clean up Redis here
  // because queues should be closed first (which cleans up their keys)
  // This prevents WRONGTYPE and "Missing key" errors from BullMQ

  if (!clickHouseClient) {
    return;
  }

  if (tenantId) {
    // Clean up specific tenant data using DELETE (TRUNCATE doesn't support WHERE)
    await clickHouseClient.exec({
      query: `
        ALTER TABLE "${TEST_DATABASE}".event_log DELETE WHERE TenantId = {tenantId:String}
      `,
      query_params: { tenantId },
    });

    await clickHouseClient.exec({
      query: `
        ALTER TABLE "${TEST_DATABASE}".stored_spans DELETE WHERE TenantId = {tenantId:String}
      `,
      query_params: { tenantId },
    });

    await clickHouseClient.exec({
      query: `
        ALTER TABLE "${TEST_DATABASE}".trace_summaries DELETE WHERE TenantId = {tenantId:String}
      `,
      query_params: { tenantId },
    });

    // Clean up test_event_handler_log (created lazily in testPipelines.ts, only
    // when events are processed, so it is absent on shards that never ran the map
    // projection). Guard on EXISTS rather than catching the error: the ClickHouse
    // client logs the "Could not find table" error BEFORE a try/catch can swallow
    // the throw, and that benign line has twice masqueraded as a real failure and
    // burned triage (#4824, PR #5071). See #5308. `EXISTS TABLE` never errors on a
    // missing table (it returns 0), so no noise is emitted on the absent path.
    const [existsRow] = await clickHouseClient
      .query({
        query: `EXISTS TABLE "${TEST_DATABASE}".test_event_handler_log`,
        format: "JSONEachRow",
      })
      .then((r) => r.json<{ result: number }>());
    if (existsRow?.result === 1) {
      await clickHouseClient.exec({
        query: `
          ALTER TABLE "${TEST_DATABASE}".test_event_handler_log DELETE WHERE TenantId = {tenantId:String}
        `,
        query_params: { tenantId },
      });
    }
  } else {
    // Clean up all test data using TRUNCATE (synchronous and faster)
    await clickHouseClient.exec({
      query: `TRUNCATE TABLE IF EXISTS "${TEST_DATABASE}".event_log`,
    });

    await clickHouseClient.exec({
      query: `TRUNCATE TABLE IF EXISTS "${TEST_DATABASE}".stored_spans`,
    });

    await clickHouseClient.exec({
      query: `TRUNCATE TABLE IF EXISTS "${TEST_DATABASE}".trace_summaries`,
    });

    // Clean up test_event_handler_log table (created in testPipelines.ts)
    await clickHouseClient.exec({
      query: `TRUNCATE TABLE IF EXISTS "${TEST_DATABASE}".test_event_handler_log`,
    });
  }
}
