import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  ClickHouseContainer,
  type StartedClickHouseContainer,
} from "@testcontainers/clickhouse";
import {
  RedisContainer,
  type StartedRedisContainer,
} from "@testcontainers/redis";
import IORedis, { type Redis } from "ioredis";
import { migrateUp } from "~/server/clickhouse/goose";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:event-sourcing:test-containers");

let clickHouseContainer: StartedClickHouseContainer | null = null;
let redisContainer: StartedRedisContainer | null = null;
let clickHouseClient: ClickHouseClient | null = null;
let redisConnection: Redis | null = null;

/**
 * Common labels for testcontainers to help with cleanup.
 * Ryuk (testcontainers' cleanup daemon) uses these labels.
 */
const CONTAINER_LABELS = {
  "langwatch.test": "true",
  "langwatch.test.type": "integration",
};

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
 * Path to the file where globalSetup writes container connection info.
 */
const CONTAINER_INFO_FILE = path.join(
  os.tmpdir(),
  "langwatch-test-containers.json",
);

/**
 * Checks if containers were started by globalSetup.
 * When globalSetup starts containers, it writes connection URLs to a temp file.
 */
function isUsingGlobalSetupContainers(): boolean {
  return !!(
    process.env.TEST_CLICKHOUSE_URL &&
    process.env.TEST_REDIS_URL
  );
}

/**
 * Loads container info from the file written by globalSetup.
 * Sets environment variables so subsequent calls to isUsingGlobalSetupContainers() return true.
 */
export function loadGlobalSetupContainerInfo(): { clickHouseUrl: string; redisUrl: string } | null {
  try {
    if (!fs.existsSync(CONTAINER_INFO_FILE)) {
      return null;
    }
    const content = fs.readFileSync(CONTAINER_INFO_FILE, "utf-8");
    const info = JSON.parse(content) as { clickHouseUrl: string; redisUrl: string };

    // Set env vars so isUsingGlobalSetupContainers() returns true
    process.env.TEST_CLICKHOUSE_URL = info.clickHouseUrl;
    process.env.TEST_REDIS_URL = info.redisUrl;

    return info;
  } catch {
    return null;
  }
}

/**
 * Starts testcontainers for ClickHouse and Redis.
 * Should be called before running integration tests.
 *
 * Priority:
 * 1. CI service containers (GitHub Actions)
 * 2. Global setup containers (started by globalSetup.ts, shared across workers)
 * 3. Local testcontainers (fallback, starts new containers per worker)
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
    await initializeClickHouseSchema(clickHouseUrl);

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
    const redisUrl = process.env.TEST_REDIS_URL!;

    if (!redisConnection) {
      redisConnection = new IORedis(redisUrl, {
        maxRetriesPerRequest: 0,
        offlineQueue: true,
      });
    }

    // Don't run migrations - globalSetup already did that
    // Create client with the database in the URL path
    const urlWithDatabase = new URL(clickHouseUrl);
    urlWithDatabase.pathname = `/${TEST_DATABASE}`;

    if (!clickHouseClient) {
      clickHouseClient = createClient({ url: urlWithDatabase });
    }

    return {
      clickHouseClient,
      redisConnection,
      clickHouseUrl,
      redisUrl,
    };
  }

  // Otherwise, use testcontainers (local development, fallback)
  // Start ClickHouse container with labels for cleanup tracking and storage policy config
  if (!clickHouseContainer) {
    const storagePolicyConfigPath = createStoragePolicyConfigFile();

    clickHouseContainer = await new ClickHouseContainer()
      .withLabels(CONTAINER_LABELS)
      .withCopyFilesToContainer([
        {
          source: storagePolicyConfigPath,
          target: "/etc/clickhouse-server/config.d/storage.xml",
        },
      ])
      .withStartupTimeout(120000) // 2 minutes for container startup
      .start();
  }

  // Start Redis container with labels for cleanup tracking
  if (!redisContainer) {
    redisContainer = await new RedisContainer()
      .withLabels(CONTAINER_LABELS)
      .start();
  }

  const clickHouseUrl = clickHouseContainer.getConnectionUrl();

  // Create ClickHouse client
  if (!clickHouseClient) {
    clickHouseClient = createClient({
      url: new URL(clickHouseUrl),
    });
  }

  // Create Redis connection
  if (!redisConnection) {
    const redisUrl = redisContainer.getConnectionUrl();
    redisConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: 0,
      offlineQueue: true,
    });
    await redisConnection.flushall();
  }

  // Run goose migrations to create database and tables
  await initializeClickHouseSchema(clickHouseUrl);

  // Close the old client and create a new one with the database in the URL path
  await clickHouseClient.close();
  const urlWithDatabase = new URL(clickHouseUrl);
  urlWithDatabase.pathname = `/${TEST_DATABASE}`;

  clickHouseClient = createClient({ url: urlWithDatabase });

  return {
    clickHouseClient,
    redisConnection,
    clickHouseUrl,
    redisUrl: redisContainer.getConnectionUrl(),
  };
}

/**
 * Stops testcontainers and cleans up connections.
 * Should be called after integration tests complete.
 *
 * Note: Only closes connections - doesn't stop containers if they were started
 * by globalSetup (those are stopped by globalSetup's teardown) or CI service containers.
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

  // Only stop containers if we started them locally (not in CI or globalSetup)
  if (!isUsingServiceContainers() && !isUsingGlobalSetupContainers()) {
    // Stop ClickHouse container
    if (clickHouseContainer) {
      try {
        await clickHouseContainer.stop({ timeout: 10000 });
      } catch (e) {
        logger.warn("Failed to stop ClickHouse container gracefully", {
          error: e,
        });
      }
      clickHouseContainer = null;
    }

    // Stop Redis container
    if (redisContainer) {
      try {
        await redisContainer.stop({ timeout: 10000 });
      } catch (e) {
        logger.warn("Failed to stop Redis container gracefully", { error: e });
      }
      redisContainer = null;
    }
  }

  if (errors.length > 0) {
    logger.warn("Errors during container cleanup", {
      errors: errors.map((e) => e.message),
    });
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
 * XML configuration for ClickHouse storage policy.
 * Defines `local_primary` policy with `hot` and `cold` volumes.
 * Uses different paths for custom disks to avoid conflict with default disk path.
 * Note: We use different subdirectories to satisfy ClickHouse's requirement that custom disk paths
 * must differ from the default disk path (/var/lib/clickhouse/).
 */
const STORAGE_POLICY_CONFIG = `
<clickhouse>
    <storage_configuration>
        <disks>
            <hot>
                <path>/var/lib/clickhouse/hot/</path>
            </hot>
            <cold>
                <path>/var/lib/clickhouse/cold/</path>
            </cold>
        </disks>
        <policies>
            <local_primary>
                <volumes>
                    <hot>
                        <disk>hot</disk>
                    </hot>
                    <cold>
                        <disk>cold</disk>
                    </cold>
                </volumes>
            </local_primary>
        </policies>
    </storage_configuration>
</clickhouse>
`.trim();

/**
 * Creates a temporary storage policy config file for ClickHouse.
 * Returns the path to the created file.
 */
function createStoragePolicyConfigFile(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clickhouse-config-"));
  const configPath = path.join(tempDir, "storage_policy.xml");
  fs.writeFileSync(configPath, STORAGE_POLICY_CONFIG);
  return configPath;
}

/**
 * Initializes ClickHouse schema using goose migrations.
 * Runs the same migrations as production to ensure schema parity.
 *
 * @param connectionUrl - The ClickHouse connection URL (without database)
 */
async function initializeClickHouseSchema(
  connectionUrl: string,
): Promise<void> {
  await migrateUp({
    connectionUrl,
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
        ALTER TABLE "${TEST_DATABASE}".processor_checkpoints DELETE WHERE TenantId = {tenantId:String}
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
      query: `TRUNCATE TABLE IF EXISTS "${TEST_DATABASE}".processor_checkpoints`,
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
