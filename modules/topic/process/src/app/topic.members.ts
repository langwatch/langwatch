import type {
  TopicClusteringTrigger,
  TopicModelEntry,
  TopicModelRecordMode,
  TopicModelRecordSource,
} from "@langwatch/topic-contract";

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
