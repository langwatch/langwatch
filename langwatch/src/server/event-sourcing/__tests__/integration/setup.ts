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
  // Tagged so the CI log shows where in the shard-end pipeline a wedge,
  // if any, actually stalls. Remove once the integration shard hang
  // diagnostic is no longer needed.
  // eslint-disable-next-line no-console
  console.log("[teardown] stopTestContainers begin");
  await stopTestContainers();
  // eslint-disable-next-line no-console
  console.log("[teardown] closeAppRuntimeSingletons begin");
  await closeAppRuntimeSingletons();
  // eslint-disable-next-line no-console
  console.log("[teardown] unrefRemainingHandles begin");
  unrefRemainingHandles();
  // eslint-disable-next-line no-console
  console.log("[teardown] done");
}

/**
 * Belt-and-suspenders: unref any sockets/timers that are still keeping the
 * event loop alive after the named teardowns above. Anything not enumerable
 * via a typed close path (HTTP keep-alive pools, BullMQ worker internals,
 * third-party background pollers) gets released here so vitest's reporter
 * can finish and the worker exits without waiting for the shard timeout.
 *
 * This is safe at this point: all tests have completed, the explicit
 * teardowns have already run, and any remaining handles are bookkeeping
 * the runtime no longer needs.
 */
function unrefRemainingHandles(): void {
  try {
    const proc = process as unknown as {
      _getActiveHandles?: () => Array<{ unref?: () => void }>;
    };
    const handles = proc._getActiveHandles?.() ?? [];
    for (const h of handles) {
      try {
        h.unref?.();
      } catch {
        // some handles are read-only; ignore
      }
    }
  } catch {
    // _getActiveHandles is an internal API; tolerate runtime variation
  }
}

/**
 * Closes the application-layer Prisma and Redis singletons that any test in
 * the shard instantiated by importing the server modules. Without this, their
 * open sockets keep the vitest worker process alive past the last test, the
 * reporter never prints the summary line, and the CI step times out at the
 * job cap.
 *
 * Dynamic-imported so the modules' top-level connection-bootstrap code runs
 * only if/when a real test already pulled them in.
 */
async function closeAppRuntimeSingletons(): Promise<void> {
  try {
    const dbMod = await import("../../../db");
    await Promise.race([
      dbMod.prisma.$disconnect(),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch {
    // No prisma client ever constructed, or already disconnected.
  }
  try {
    const redisMod = await import("../../../redis");
    const conn = redisMod.connection;
    if (conn) {
      await Promise.race([
        Promise.resolve(conn.quit()).catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
      try {
        conn.disconnect();
      } catch {
        // already disconnected
      }
    }
  } catch {
    // Redis was never instantiated in this shard, or already disconnected.
  }
}

// Register global setup/teardown hooks
beforeAll(setup, 60000); // 60 second timeout for container startup
afterAll(teardown, 30000); // 30 second timeout for cleanup
