export interface EventingClickHouseQueryResult {
  json<Row>(): Promise<Row[]>;
}

export interface EventingClickHouseClient {
  query: (request: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
  }) => Promise<EventingClickHouseQueryResult>;
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

/**
 * One statement replay runs, in the routed ClickHouse member's own vocabulary (ARCHITECTURE §7): it
 * names its tenant, and a statement spanning every tenant names none (`""`) with a written reason.
 */
export interface EventingClickHouseReplayStatement {
  tenantId: string;
  sql: string;
  params?: Record<string, unknown> | undefined;
  /** Set when the statement genuinely spans tenants; see the member's tenant-scope guard. */
  unscoped?: { reason: string } | undefined;
}

/**
 * The reads replay needs, which the routed member answers itself, so no adapter stands between
 * them: whole results, streamed rows (a batch's memory stays bounded by the accumulators rather
 * than its event count), and `command` for the post-replay `OPTIMIZE TABLE`.
 */
export interface EventingClickHouseReplayClient {
  query<Row>(request: EventingClickHouseReplayStatement): Promise<{ rows: Row[] }>;
  stream<Row>(request: EventingClickHouseReplayStatement): AsyncIterable<Row[]>;
  command(request: EventingClickHouseReplayStatement): Promise<void>;
}
