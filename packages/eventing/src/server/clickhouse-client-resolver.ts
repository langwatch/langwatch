export interface EventingClickHouseQueryResult {
  json<Row>(): Promise<Row[]>;
}

export interface EventingClickHouseClient {
  query(request: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<EventingClickHouseQueryResult>;
  insert(request: {
    table: string;
    values: readonly Record<string, unknown>[];
    format: "JSONEachRow";
    clickhouse_settings: Record<string, number>;
  }): Promise<unknown>;
}

/**
 * Tenant-aware ClickHouse resolution is composed by the process root. Eventing
 * uses this port and never reads routing configuration or constructs clients.
 */
export type EventingClickHouseClientResolver = (
  tenantId: string,
) => Promise<EventingClickHouseClient>;
