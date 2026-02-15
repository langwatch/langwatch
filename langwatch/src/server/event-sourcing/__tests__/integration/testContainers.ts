import { type ClickHouseClient, createClient } from "@clickhouse/client";
import IORedis, { type Redis } from "ioredis";
import { migrateUp } from "~/server/clickhouse/goose";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:event-sourcing:test-containers");

let clickHouseClient: ClickHouseClient | null = null;
let redisConnection: Redis | null = null;

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

    // Run goose migrations to create database and tables
    await initializeClickHouseSchema(clickHouseUrl, TEST_DATABASE);

    // Create client with the database in the URL path
    const urlWithDatabase = new URL(clickHouseUrl);
    urlWithDatabase.pathname = `/${TEST_DATABASE}`;

    clickHouseClient = createClient({ url: urlWithDatabase });

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
    if (!clickHouseClient) {
      clickHouseClient = createClient({ url: new URL(clickHouseUrl) });
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

  // Close ClickHouse client
  if (clickHouseClient) {
    try {
      await clickHouseClient.close();
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
    clickHouseClient = null;
  }

  // Close Redis connection
  if (redisConnection) {
    try {
      await redisConnection.quit();
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
    redisConnection = null;
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
    // Full cleanup - flush all Redis data
    await redisConnection.flushall();
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

    // Clean up test_event_handler_log table (created in testPipelines.ts)
    // Use try/catch since the table may not exist if no events were processed
    try {
      await clickHouseClient.exec({
        query: `
          ALTER TABLE "${TEST_DATABASE}".test_event_handler_log DELETE WHERE TenantId = {tenantId:String}
        `,
        query_params: { tenantId },
      });
    } catch {
      // Table doesn't exist - this is fine
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
