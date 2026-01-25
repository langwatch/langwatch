/**
 * This file MUST run before any other imports.
 * It reads the container info from globalSetup and sets environment variables
 * BEFORE any application modules are loaded.
 *
 * IMPORTANT: This file must NOT import any application code, only Node.js built-ins.
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
} catch (error) {
  console.warn("[env-setup] Failed to load container info:", error);
}
