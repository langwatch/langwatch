import { type ClickHouseClient, createClient } from "@clickhouse/client";

export interface ClickHouseFactoryOptions {
  url?: string;
  enabled?: boolean;
}

export function createClickHouseClientFromConfig(
  opts: ClickHouseFactoryOptions,
): ClickHouseClient | null {
  if (!opts.enabled || !opts.url) return null;

  let url: URL | string = opts.url;
  try {
    url = new URL(opts.url);
  } catch {
    // If not a valid URL, pass the raw string — ClickHouse client may still accept it
  }

  return createClient({
    url,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
}
