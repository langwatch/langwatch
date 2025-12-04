import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { env } from "../../env.mjs";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:clickhouse:client");

let clickHouseClient: ClickHouseClient | null = null;

/**
 * Get or create a ClickHouse client instance
 */
export function getClickHouseClient(): ClickHouseClient | null {
  if (!clickHouseClient && env.ENABLE_CLICKHOUSE && env.CLICKHOUSE_URL) {
    let url: URL | string = env.CLICKHOUSE_URL;

    try {
      url = new URL(env.CLICKHOUSE_URL);
    } catch (error) {
      logger.warn({ error }, 'ClickHouse URL was not a valid URL, it will still be set, but may not work as expected.');
    }

    clickHouseClient = createClient({ url });
  }

  return clickHouseClient;
}

export async function closeClickHouseClient(): Promise<void> {
  if (clickHouseClient) {
    await clickHouseClient.close();
    clickHouseClient = null;
  }
}
