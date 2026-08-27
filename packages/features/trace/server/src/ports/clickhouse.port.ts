/** Minimal ClickHouse client primitive accepted by the composition adapter. */
export interface TraceClickHouseClient {
  query<Row>(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string>;
  }): Promise<{ json<T = Row>(): Promise<T[]> }>;
}

export type TraceClickHouseResolver = (tenantId: string) => Promise<TraceClickHouseClient>;

export abstract class TraceClickHousePort {
  abstract resolve(tenantId: string): Promise<TraceClickHouseClient>;
}
