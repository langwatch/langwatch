import type {
  BatchClusteringParams,
  IncrementalClusteringParams,
} from "@langwatch/topic-contract";

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

export abstract class TopicClusteringLangevalsPort {
  abstract postClustering(params: {
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
