import type {
  TopicClusteringTrigger,
  TopicModelEntry,
  TopicModelRecordMode,
  TopicModelRecordSource,
} from "@langwatch/topic-contract";

/**
 * The pipeline command boundary for the clustering runner and the boot
 * migration: the topic pipeline's own `recordTopics` / `requestClustering`,
 * and the trace pipeline's `assignTopic` as a narrow port — the topic feature
 * never imports the trace contract.
 *
 * Composition late-binds these to the registered pipelines' commands (they
 * exist only after the pipelines build).
 */
export abstract class TopicClusteringCommandsPort {
  abstract recordTopics(args: {
    tenantId: string;
    occurredAt: number;
    mode: TopicModelRecordMode;
    source: TopicModelRecordSource;
    dedupeKey: string;
    topics: TopicModelEntry[];
  }): Promise<void>;

  abstract requestClustering(args: {
    tenantId: string;
    occurredAt: number;
    trigger: TopicClusteringTrigger;
    requestedByUserId?: string;
  }): Promise<void>;

  abstract assignTopic(args: {
    tenantId: string;
    traceId: string;
    topicId: string | null;
    topicName: string | null;
    subtopicId: string | null;
    subtopicName: string | null;
    isIncremental: boolean;
    occurredAt: number;
  }): Promise<void>;
}
