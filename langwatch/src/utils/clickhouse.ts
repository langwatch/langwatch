import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { env } from "../env.mjs";

let clickHouseClient: ClickHouseClient | null = null;

/**
 * Get or create a ClickHouse client instance
 */
export function getClickHouseClient(): ClickHouseClient | null {
  if (!clickHouseClient && env.CLICKHOUSE_URL) {
    clickHouseClient = createClient({
      url: new URL(env.CLICKHOUSE_URL),
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
