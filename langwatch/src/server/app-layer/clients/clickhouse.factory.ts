import { createClient } from "@clickhouse/client";
import { ClickHouseLogger } from "~/server/clickhouse/clickhouseLogger";
import { getClickHouseMaxOpenConnections } from "~/server/clickhouse/connectionPool";
import type { ResilientClickHouseClient } from "./clickhouse/resilient-client";
import { createResilientClickHouseClient } from "./clickhouse.resilient";

export interface ClickHouseFactoryOptions {
  url?: string;
  enabled?: boolean;
}

export function createClickHouseClientFromConfig(
  opts: ClickHouseFactoryOptions,
): ResilientClickHouseClient | null {
  if (!opts.enabled || !opts.url) return null;

  let url: URL | string = opts.url;
  try {
    url = new URL(opts.url);
  } catch {
    // If not a valid URL, pass the raw string — ClickHouse client may still accept it
  }

  const raw = createClient({
    url,
    clickhouse_settings: { date_time_input_format: "best_effort" },
    max_open_connections: getClickHouseMaxOpenConnections(),
    keep_alive: {
      enabled: true,
      idle_socket_ttl: 1500,
    },
    log: { LoggerClass: ClickHouseLogger },
  });

  return createResilientClickHouseClient({ client: raw });
}
