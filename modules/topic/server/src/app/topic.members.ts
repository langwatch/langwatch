import type { BatchClusteringParams, IncrementalClusteringParams, TopicClusteringTrigger, TopicModelEntry, TopicModelRecordMode, TopicModelRecordSource } from "@langwatch/topic-contract";
export interface TopicInfrastructure {  langevalsPayloadStaging: LangevalsPayloadStaging;
  topicClusteringClickHouse: TopicClusteringClickHouse;
  topicClusteringCommands: TopicClusteringCommands;
  topicClusteringLangevals: TopicClusteringLangevals;
}

/** One parked payload, as the caller needs it back to fetch and to discard it. */
export interface StagedLangevalsPayload {
  /** The presigned GET URL the receiver fetches the body from. */
  readonly url: string;
  /**
   * Removes the parked object. Best-effort by contract: staged bodies carry
   * customer trace data and provider credentials, so the caller always asks,
   * and a bucket lifecycle rule on the staging prefix is the fallback for the
   * crash paths where the ask never happens.
   */
  discard(): Promise<void>;
}


export interface LangevalsPayloadStaging {
  stage(input: {
    projectId: string;
    /** The path segment the parked object is filed under. */
    keyPrefix: string;
    serialized: Buffer;
    ttlSeconds: number;
    /**
     * The caller's deadline. The upload runs BEFORE the langevals call, so an
     * unsignalled put would spend the whole deadline — and, for topic
     * clustering, the whole lease — before an abort could bite.
     */
    signal?: AbortSignal | undefined;
  }): Promise<StagedLangevalsPayload>;
}

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

/**
 * The langevals boundary for topic clustering (the workspace member at
 * services/langevals/evaluators/topic_clustering — contract.md §11).
 *
 * The composition-side implementation posts through the app's staged fetch:
 * langevals runs on AWS Lambda, which hard-caps sync invokes at 6 MB, so
 * anything past the staging threshold rides over S3 via a presigned URL.
 */
export type TopicClusteringLangevalsKind =
  | "topic_clustering_batch"
  | "topic_clustering_incremental";

/** The slice of the fetch Response the clustering exchange reads. */
export interface TopicClusteringLangevalsResponse {
  readonly ok: boolean;
  readonly statusText: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}


export interface TopicClusteringLangevals {
  postClustering(params: {
    url: string;
    body: BatchClusteringParams | IncrementalClusteringParams;
    projectId: string;
    kind: TopicClusteringLangevalsKind;
    /**
     * Client deadline / cancellation, forwarded verbatim to fetch(). The
     * caller's work is leased through the outbox, so every call carries the
     * clustering request deadline's signal.
     */
    signal?: AbortSignal;
  }): Promise<TopicClusteringLangevalsResponse>;
}
