/**
 * The clustering runner's ClickHouse boundary: just enough of the client for
 * the trace_summaries page queries. Mirrors the data-retention server
 * precedent — the feature declares its own narrow port and composition
 * adapts the real client; no Trace repositories are imported.
 */
export type TopicClusteringClickHouseQueryParams = Record<string, string | number | string[]>;

export type TopicClusteringClickHouseQuery = {
  query: string;
  query_params: TopicClusteringClickHouseQueryParams;
  format: "JSONEachRow";
  clickhouse_settings?: Record<string, number>;
};

export abstract class TopicClusteringClickHousePort {
  abstract query(input: TopicClusteringClickHouseQuery): Promise<{
    json(): Promise<unknown>;
  }>;
}

/** Resolves the tenant's client; throws when ClickHouse is unavailable. */
export type TopicClusteringClickHouseResolver = (
  tenantId: string,
) => Promise<TopicClusteringClickHousePort>;
