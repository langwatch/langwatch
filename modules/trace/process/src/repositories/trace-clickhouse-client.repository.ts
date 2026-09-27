/** Minimal ClickHouse client primitive; rows arrive unknown and each caller parses its own. */
export interface TraceClickHouseClient {
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string>;
  }): Promise<{ json(): Promise<unknown[]> }>;
}

export interface TraceClickHouseWriteClient extends TraceClickHouseClient {
  insert(input: {
    table: string;
    /**
     * Read-only on purpose: nothing behind this port mutates the batch it
     * is handed, so a caller holding a `readonly` row array (the Eventing
     * client a background process composes) satisfies it without copying.
     */
    values: readonly unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown>;
}

export type TraceClickHouseResolver = (tenantId: string) => Promise<TraceClickHouseClient>;
export type TraceClickHouseWriteResolver = (
  tenantId: string,
) => Promise<TraceClickHouseWriteClient>;

export abstract class TraceClickHouse {
  abstract resolve(tenantId: string): Promise<TraceClickHouseClient>;
}
