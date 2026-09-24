import type {
  TopicClusteringTrigger,
  TopicModelEntry,
  TopicModelRecordMode,
  TopicModelRecordSource,
} from "@langwatch/topic-contract";

/**
 * The clustering runner's ClickHouse boundary: just enough of the client
 * for the trace_summaries page queries. Mirrors data-retention's own narrow
 * port; composition adapts the real client, no Trace repositories imported.
 */
export type TopicClusteringClickHouseQueryParams = Record<string, string | number | string[]>;

export type TopicClusteringClickHouseQuery = {
  query: string;
  query_params: TopicClusteringClickHouseQueryParams;
  format: "JSONEachRow";
  clickhouse_settings?: Record<string, number>;
};

export interface TopicClusteringClickHouse {
  query(input: TopicClusteringClickHouseQuery): Promise<{
    json(): Promise<unknown>;
  }>;
}

/** Resolves the tenant's client; throws when ClickHouse is unavailable. */
export type TopicClusteringClickHouseResolver = (
  tenantId: string,
) => Promise<TopicClusteringClickHouse>;

/**
 * The pipeline command boundary for the clustering runner and the boot
 * migration. Composition binds these to the registered Topic pipeline after
 * it exists; Trace assignment is a separate Trace-owned contract port.
 */
export interface TopicClusteringCommands {
  recordTopics(args: {
    tenantId: string;
    occurredAt: number;
    mode: TopicModelRecordMode;
    source: TopicModelRecordSource;
    dedupeKey: string;
    topics: TopicModelEntry[];
  }): Promise<void>;

  requestClustering(args: {
    tenantId: string;
    occurredAt: number;
    trigger: TopicClusteringTrigger;
    requestedByUserId?: string;
  }): Promise<void>;
}
