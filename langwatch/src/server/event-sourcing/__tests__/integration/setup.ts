/**
 * Integration test setup file.
 *
 * This file reads container info from globalSetup and connects to containers.
 * CI environment variables are handled in vitest.integration.config.ts which
 * runs earlier (at config load time, before modules are parsed).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
 * Per-file teardown for integration tests.
 * Closes connections but does NOT flush Redis.
 *
 * Important: We don't call cleanupTestData() here because:
 * 1. Each test uses unique tenant IDs and pipeline names for isolation
 * 2. Each test's afterEach already cleans up its own data via cleanupTestDataForTenant()
 * 3. Calling cleanupTestData() without tenantId triggers FLUSHALL which races with
 *    BullMQ workers that may still be completing (causes "Missing key for job" errors)
 */
export async function teardown(): Promise<void> {
  await stopTestContainers();
}

// Register global setup/teardown hooks
beforeAll(setup, 60000); // 60 second timeout for container startup
afterAll(teardown, 30000); // 30 second timeout for cleanup
