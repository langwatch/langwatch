/** Minimal ClickHouse client primitive accepted by the composition adapter. */
export interface TraceClickHouseClient {
  query<Row>(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string>;
  }): Promise<{ json<T = Row>(): Promise<T[]> }>;
}

export interface TraceClickHouseWriteClient extends TraceClickHouseClient {
  insert(input: {
    table: string;
    /**
     * Read-only on purpose: nothing behind this port mutates the batch it is
     * handed, and saying so is what lets a caller holding a `readonly` row
     * array — the Eventing ClickHouse client a background process composes
     * from — satisfy the port without copying every insert.
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

export abstract class TraceClickHousePort {
  abstract resolve(tenantId: string): Promise<TraceClickHouseClient>;
}
