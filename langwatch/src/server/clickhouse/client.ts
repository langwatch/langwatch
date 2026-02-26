import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:clickhouse:client");

let clickHouseClient: ClickHouseClient | null = null;

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
 * Get or create a ClickHouse client instance
 */
export function getClickHouseClient(): ClickHouseClient | null {
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

    clickHouseClient = createClient({
      url,
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        wait_for_async_insert: 1,
      },
    });
  }

  return clickHouseClient;
}

export async function closeClickHouseClient(): Promise<void> {
  if (clickHouseClient) {
    await clickHouseClient.close();
    clickHouseClient = null;
  }
}
