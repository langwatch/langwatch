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

/** One row of a streamed `JSONEachRow` result set. */
export interface EventingClickHouseRow {
  json<Row>(): Row;
}

/** A `JSONEachRow` result consumed batch-by-batch rather than materialized. */
export interface EventingClickHouseStreamingQueryResult extends EventingClickHouseQueryResult {
  stream(): AsyncIterable<EventingClickHouseRow[]>;
}

/**
 * The wider read surface replay needs on top of {@link EventingClickHouseClient}:
 * streamed rows, so a batch's memory stays bounded by the accumulators rather
 * than its event count, and `command` for the post-replay `OPTIMIZE TABLE`.
 *
 * Declared standalone rather than extending the narrow client, so neither
 * surface constrains the other. A driver client satisfies both structurally.
 */
export interface EventingClickHouseReplayClient {
  query(request: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<EventingClickHouseStreamingQueryResult>;
  command(request: { query: string; query_params?: Record<string, unknown> }): Promise<unknown>;
}

/** Tenant-aware resolution of the replay read client, composed by the process root. */
export type EventingClickHouseReplayClientResolver = (
  tenantId: string,
) => Promise<EventingClickHouseReplayClient>;
