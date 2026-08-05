import type { ClickHouseClient } from "@clickhouse/client";
import {
  createManagedClickHouseClient,
  SHARED_INSTANCE,
} from "./managedClient";
import { unregisterClickHouseLimiter } from "./metrics";

let clickHouseClient: ClickHouseClient | null = null;

/**
 * Get or create the shared ClickHouse client instance (from env vars).
 *
 * Throws if CLICKHOUSE_URL is not set (ClickHouse is now required).
 * Skipped only during build time (vitest / next build).
 *
 * NOT exported — all external code must use the org-aware functions
 * in clickhouseClient.ts to prevent data leaks between tenants.
 */
function getClickHouseClient(): ClickHouseClient | null {
  // During unit/integration tests or next build (set in vitest.config.ts)
  if (process.env.BUILD_TIME) return null;

  if (!clickHouseClient) {
    const clickHouseUrl = process.env.CLICKHOUSE_URL;
    if (!clickHouseUrl) {
      const banner = [
        "",
        "╔══════════════════════════════════════════════════════════════╗",
        "║                                                            ║",
        "║   CLICKHOUSE_URL is not set                                ║",
        "║                                                            ║",
        "║   ClickHouse is the primary data store for LangWatch.      ║",
        "║   The application cannot start without it.                 ║",
        "║                                                            ║",
        "║   Quick start:                                             ║",
        "║     docker run -d -p 8123:8123 clickhouse/clickhouse-server║",
        "║     export CLICKHOUSE_URL=http://localhost:8123/langwatch  ║",
        "║                                                            ║",
        "║   Full guide:                                              ║",
        "║     dev/docs/adr/004-docker-dev-environment.md             ║",
        "║                                                            ║",
        "╚══════════════════════════════════════════════════════════════╝",
        "",
      ].join("\n");
      console.error(banner);
      throw new Error("CLICKHOUSE_URL environment variable is required.");
    }

    clickHouseClient = createManagedClickHouseClient({
      url: clickHouseUrl,
      instance: SHARED_INSTANCE,
    });
  }

  return clickHouseClient;
}

export async function closeClickHouseClient(): Promise<void> {
  if (clickHouseClient) {
    await clickHouseClient.close();
    clickHouseClient = null;
    // The limiter goes with the client it bounded. Left registered, its gauges
    // would keep reporting a bound that no longer fronts anything.
    unregisterClickHouseLimiter(SHARED_INSTANCE);
  }
}

// Internal access for clickhouseClient.ts — the only allowed consumer
export { getClickHouseClient as _getSharedClickHouseClient };
