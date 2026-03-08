import type { createClient } from "@clickhouse/client";

type ClickHouseClient = ReturnType<typeof createClient>;

/** Extract the clickhouse_settings type from the client's insert method parameters. */
type InsertParams = Parameters<ClickHouseClient["insert"]>[0];
type CHSettings = InsertParams extends { clickhouse_settings?: infer S } ? S : never;

interface BufferedBatch {
  values: unknown[];
  format: string;
  clickhouse_settings?: CHSettings;
}

/**
 * Wraps a ClickHouse client to buffer `insert()` calls by table
 * and flush them in larger batches — reducing HTTP round-trips.
 *
 * All other methods (query, close, etc.) are proxied through unchanged.
 *
 * Usage:
 *   const { client, flush } = createBatchingClickHouseClient(rawClient, 500);
 *   // Pass `client` wherever a ClickHouseClient is expected
 *   // Call flush() at batch boundaries or before shutdown
 */
export function createBatchingClickHouseClient(
  inner: ClickHouseClient,
  flushSize: number,
): { client: ClickHouseClient; flush: () => Promise<void> } {
  const buffers = new Map<string, BufferedBatch>();

  async function flushTable(table: string): Promise<void> {
    const batch = buffers.get(table);
    if (!batch || batch.values.length === 0) return;

    const values = batch.values.splice(0);
    await inner.insert({
      table,
      values,
      format: batch.format as any,
      clickhouse_settings: batch.clickhouse_settings,
    });
  }

  async function flushAll(): Promise<void> {
    for (const table of buffers.keys()) {
      await flushTable(table);
    }
  }

  const handler: ProxyHandler<ClickHouseClient> = {
    get(target, prop, receiver) {
      if (prop === "insert") {
        return async (opts: {
          table: string;
          values: unknown[];
          format?: string;
          clickhouse_settings?: CHSettings;
          [key: string]: unknown;
        }) => {
          const table = opts.table;
          let batch = buffers.get(table);
          if (!batch) {
            batch = {
              values: [],
              format: opts.format ?? "JSONEachRow",
              clickhouse_settings: opts.clickhouse_settings,
            };
            buffers.set(table, batch);
          }

          if (Array.isArray(opts.values)) {
            batch.values.push(...opts.values);
          }

          if (batch.values.length >= flushSize) {
            await flushTable(table);
          }
        };
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  };

  return {
    client: new Proxy(inner, handler),
    flush: flushAll,
  };
}
