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

function isFieldTooLongError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Field value too long");
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

  async function insertWithRetry(
    table: string,
    values: unknown[],
    format: string,
    settings?: CHSettings,
  ): Promise<void> {
    try {
      await inner.insert({
        table,
        values,
        format: format as any,
        clickhouse_settings: settings,
      });
    } catch (err) {
      if (isFieldTooLongError(err) && values.length > 1) {
        const mid = Math.ceil(values.length / 2);
        await insertWithRetry(table, values.slice(0, mid), format, settings);
        await insertWithRetry(table, values.slice(mid), format, settings);
        return;
      }
      throw err;
    }
  }

  async function flushTable(table: string): Promise<void> {
    const batch = buffers.get(table);
    if (!batch || batch.values.length === 0) return;

    while (batch.values.length > 0) {
      const chunkSize = Math.min(flushSize, batch.values.length);
      const chunk = batch.values.splice(0, chunkSize);
      await insertWithRetry(table, chunk, batch.format, batch.clickhouse_settings);
    }
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
