/**
 * Integration test setup file.
 *
 * IMPORTANT: The env-setting code at the top of this file MUST run before any
 * application imports. This sets REDIS_URL/CLICKHOUSE_URL from the container
 * info file written by globalSetup, before redis.ts or other modules are loaded.
 *
 * This file must be FIRST in vitest's setupFiles to ensure env vars are set
 * before test-setup.ts imports anything.
 */

// === ENV SETUP (runs at import time, before any other imports) ===
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// === Handle CI environment (GitHub Actions service containers) ===
// CI sets CI_REDIS_URL and CI_CLICKHOUSE_URL, but application code expects
// REDIS_URL and CLICKHOUSE_URL. Copy these over before any other setup.
if (process.env.CI && process.env.CI_REDIS_URL) {
  process.env.REDIS_URL = process.env.CI_REDIS_URL;
}
if (process.env.CI && process.env.CI_CLICKHOUSE_URL) {
  process.env.CLICKHOUSE_URL = process.env.CI_CLICKHOUSE_URL;
  process.env.TEST_CLICKHOUSE_URL = process.env.CI_CLICKHOUSE_URL;
}

const CONTAINER_INFO_FILE = path.join(
  os.tmpdir(),
  "langwatch-test-containers.json",
);

try {
  if (fs.existsSync(CONTAINER_INFO_FILE)) {
    const content = fs.readFileSync(CONTAINER_INFO_FILE, "utf-8");
    const info = JSON.parse(content) as {
      clickHouseUrl: string;
      redisUrl: string;
    };

    // Set the standard env vars so application code (redis.ts, etc.) can use them
    // These MUST be set before redis.ts is imported
    process.env.REDIS_URL = info.redisUrl;
    process.env.CLICKHOUSE_URL = info.clickHouseUrl;

    // Set test-prefixed var for ClickHouse (used by isUsingGlobalSetupContainers())
    process.env.TEST_CLICKHOUSE_URL = info.clickHouseUrl;

    // Unset BUILD_TIME to allow redis.ts to create a connection
    // BUILD_TIME is used during Next.js build to skip env validation,
    // but for integration tests we need actual Redis connections
    delete process.env.BUILD_TIME;
  }
} catch {
  // Silently ignore - containers may be started another way (CI, local testcontainers)
}

// === END ENV SETUP ===

// Now safe to import application code
import { afterAll, beforeAll } from "vitest";
import {
  cleanupTestData,
  startTestContainers,
  stopTestContainers,
} from "./testContainers";

/**
 * Global setup for integration tests.
 * Connects to containers (env vars already set at module load time).
 */
export async function setup(): Promise<void> {
  try {
    await startTestContainers();
  } catch (error) {
    throw error;
  }
  // Don't clean up all data here - each test uses unique tenant IDs
  // and cleans up its own data in afterEach
}

/**
 * Global teardown for integration tests.
 * Stops testcontainers after all tests.
 */
export async function teardown(): Promise<void> {
  await cleanupTestData();
  await stopTestContainers();
}

// Register global setup/teardown hooks
beforeAll(setup, 60000); // 60 second timeout for container startup
afterAll(teardown, 30000); // 30 second timeout for cleanup
