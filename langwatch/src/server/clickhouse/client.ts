import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createResilientClickHouseClient } from "~/server/app-layer/clients/clickhouse.resilient";
import { createLogger } from "~/utils/logger/server";
import { wrapWithDefaultSettings } from "./safeClickhouseClient";

const logger = createLogger("langwatch:clickhouse:client");

let clickHouseClient: ClickHouseClient | null = null;
let clickHouseWriteClient: ClickHouseClient | null = null;

/**
 * Checks if ClickHouse should be skipped.
 * Uses process.env directly to avoid triggering @t3-oss/env validation at module load.
 * This prevents false "client-side access" errors during vitest execution.
 */
function shouldSkipClickHouse(): boolean {
  // During unit/integration tests (set in vitest.config.ts)
  if (process.env.BUILD_TIME) return true;

  // ClickHouse not enabled or URL not provided
  if (!process.env.ENABLE_CLICKHOUSE || !process.env.CLICKHOUSE_URL)
    return true;

  return false;
}

/**
 * Get or create the shared ClickHouse client instance (from env vars).
 *
 * NOT exported — all external code must use the org-aware functions
 * in clickhouseClient.ts to prevent data leaks between tenants.
 */
function getClickHouseClient(): ClickHouseClient | null {
  if (!clickHouseClient && !shouldSkipClickHouse()) {
    const clickHouseUrl = process.env.CLICKHOUSE_URL!;
    let url: URL | string = clickHouseUrl;

    try {
      url = new URL(clickHouseUrl);
    } catch (error) {
      logger.warn(
        { error },
        "ClickHouse URL was not a valid URL, it will still be set, but may not work as expected.",
      );
    }

    const raw = createClient({
      url,
      clickhouse_settings: {
        date_time_input_format: "best_effort",
      },
      max_open_connections: 25,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: 1500,
      },
    });

    clickHouseClient = wrapWithDefaultSettings(
      createResilientClickHouseClient({ client: raw }),
    );
  }

  return clickHouseClient;
}

/**
 * Get or create a ClickHouse client pinned to the write (primary) replica.
 *
 * Uses CLICKHOUSE_WRITE_URL if set, otherwise falls back to CLICKHOUSE_URL.
 * Fold stores use this for read-after-write consistency — in replicated setups,
 * reading from the same node that wrote avoids replication lag entirely.
 */
function getClickHouseWriteClient(): ClickHouseClient | null {
  if (!clickHouseWriteClient && !shouldSkipClickHouse()) {
    const masterUrl = process.env.CLICKHOUSE_WRITE_URL;
    if (!masterUrl) {
      // No write URL configured — use the shared client (single-node or dev)
      return getClickHouseClient();
    }

    let url: URL | string = masterUrl;
    try {
      url = new URL(masterUrl);
    } catch (error) {
      logger.warn(
        { error },
        "ClickHouse write URL was not a valid URL, it will still be set, but may not work as expected.",
      );
    }

    const raw = createClient({
      url,
      clickhouse_settings: {
        date_time_input_format: "best_effort",
      },
      max_open_connections: 10,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: 1500,
      },
    });

    clickHouseWriteClient = wrapWithDefaultSettings(
      createResilientClickHouseClient({ client: raw }),
    );
  }

  return clickHouseWriteClient;
}

export async function closeClickHouseClient(): Promise<void> {
  if (clickHouseClient) {
    await clickHouseClient.close();
    clickHouseClient = null;
  }
  if (clickHouseWriteClient) {
    await clickHouseWriteClient.close();
    clickHouseWriteClient = null;
  }
}

// Internal access for clickhouseClient.ts — the only allowed consumer
export { getClickHouseClient as _getSharedClickHouseClient };
export { getClickHouseWriteClient as _getWriteClickHouseClient };
