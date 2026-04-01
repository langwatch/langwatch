import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createResilientClickHouseClient } from "~/server/app-layer/clients/clickhouse.resilient";
import { createLogger } from "~/utils/logger/server";
import { wrapWithDefaultSettings } from "./safeClickhouseClient";

const logger = createLogger("langwatch:clickhouse:client");

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
      // TODO: see the ClickHouse migration and setup guide:
      // https://github.com/langwatch/langwatch/blob/main/dev/docs/adr/004-docker-dev-environment.md
      throw new Error(
        "CLICKHOUSE_URL environment variable is required. " +
        "ClickHouse is the primary data store — see dev/docs/adr/004-docker-dev-environment.md for setup instructions.",
      );
    }

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

export async function closeClickHouseClient(): Promise<void> {
  if (clickHouseClient) {
    await clickHouseClient.close();
    clickHouseClient = null;
  }
}

// Internal access for clickhouseClient.ts — the only allowed consumer
export { getClickHouseClient as _getSharedClickHouseClient };
