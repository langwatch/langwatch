import {
  ClickHouseContainer,
  type StartedClickHouseContainer,
} from "@testcontainers/clickhouse";
import {
  RedisContainer,
  type StartedRedisContainer,
} from "@testcontainers/redis";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { migrateUp } from "~/server/clickhouse/goose";

const TEST_DATABASE = "test_langwatch";

/**
 * Path to the file where container connection info is stored.
 * This file is used to share connection URLs between globalSetup and test workers.
 */
export const CONTAINER_INFO_FILE = path.join(
  os.tmpdir(),
  "langwatch-test-containers.json",
);

/**
 * Common labels for testcontainers to help with cleanup.
 */
const CONTAINER_LABELS = {
  "langwatch.test": "true",
  "langwatch.test.type": "integration",
};

/**
 * XML configuration for ClickHouse storage policy.
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
 */
function createStoragePolicyConfigFile(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clickhouse-config-"));
  const configPath = path.join(tempDir, "storage_policy.xml");
  fs.writeFileSync(configPath, STORAGE_POLICY_CONFIG);
  return configPath;
}

let clickHouseContainer: StartedClickHouseContainer | null = null;
let redisContainer: StartedRedisContainer | null = null;

/**
 * Global setup for integration tests.
 * Starts testcontainers ONCE before all test files run.
 * Connection URLs are written to a temp file for test workers to read.
 */
export async function setup(): Promise<void> {
  // Skip if using CI service containers
  if (process.env.CI_CLICKHOUSE_URL && process.env.CI_REDIS_URL && process.env.CI) {
    console.log("[globalSetup] Using CI service containers");
    return;
  }

  console.log("[globalSetup] Starting testcontainers...");

  // Start ClickHouse container
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

  // Start Redis container
  redisContainer = await new RedisContainer()
    .withLabels(CONTAINER_LABELS)
    .start();

  const clickHouseBaseUrl = clickHouseContainer.getConnectionUrl();
  const redisUrl = redisContainer.getConnectionUrl();

  // Run goose migrations to create database and tables
  // Important: Pass the database name explicitly since the container's URL uses 'test' as default
  console.log("[globalSetup] Running ClickHouse migrations...");
  await migrateUp({
    connectionUrl: clickHouseBaseUrl,
    database: TEST_DATABASE,
    verbose: false,
  });

  // Create URL with the correct database name for test workers
  const urlWithDatabase = new URL(clickHouseBaseUrl);
  urlWithDatabase.pathname = `/${TEST_DATABASE}`;
  const clickHouseUrl = urlWithDatabase.toString();

  // Write connection URLs to a temp file for test workers to read
  const containerInfo = {
    clickHouseUrl,
    redisUrl,
  };
  fs.writeFileSync(CONTAINER_INFO_FILE, JSON.stringify(containerInfo));

  console.log(`[globalSetup] ClickHouse URL: ${clickHouseUrl}`);
  console.log(`[globalSetup] Redis URL: ${redisUrl}`);
  console.log(`[globalSetup] Container info written to: ${CONTAINER_INFO_FILE}`);
  console.log("[globalSetup] Testcontainers started successfully");
}

/**
 * Global teardown for integration tests.
 * Stops testcontainers after all test files complete.
 */
export async function teardown(): Promise<void> {
  // Skip if using CI service containers
  if (process.env.CI_CLICKHOUSE_URL && process.env.CI_REDIS_URL && process.env.CI) {
    return;
  }

  console.log("[globalSetup] Stopping testcontainers...");

  // Clean up the container info file
  try {
    fs.unlinkSync(CONTAINER_INFO_FILE);
  } catch {
    // File might not exist
  }

  if (clickHouseContainer) {
    await clickHouseContainer.stop({ timeout: 10000 });
    clickHouseContainer = null;
  }

  if (redisContainer) {
    await redisContainer.stop({ timeout: 10000 });
    redisContainer = null;
  }

  console.log("[globalSetup] Testcontainers stopped");
}
