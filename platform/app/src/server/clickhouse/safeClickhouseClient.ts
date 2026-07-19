import type { ClickHouseClient } from "@clickhouse/client";
import { DEFAULT_CLICKHOUSE_SETTINGS } from "./queryDefaults";

/**
 * Wraps a ClickHouseClient so that every `.query()` call automatically
 * receives {@link DEFAULT_CLICKHOUSE_SETTINGS} (memory limits, spill-to-disk).
 *
 * Caller-supplied `clickhouse_settings` are merged on top, so specific
 * overrides (e.g. `ANALYTICS_CLICKHOUSE_SETTINGS` with a higher memory cap)
 * still take effect.
 *
 * Non-query methods (`insert`, `command`, `exec`, `close`, etc.) pass through
 * unmodified.
 */
export function wrapWithDefaultSettings(
  client: ClickHouseClient,
): ClickHouseClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== "query") {
        return Reflect.get(target, prop, receiver);
      }

      return (params: Record<string, unknown>) => {
        const merged = {
          ...params,
          clickhouse_settings: {
            ...DEFAULT_CLICKHOUSE_SETTINGS,
            ...(params.clickhouse_settings as Record<string, unknown> | undefined),
          },
        };
        return target.query(merged as Parameters<typeof target.query>[0]);
      };
    },
  });
}
