import type {
  Topic,
  TopicClusteringRunHistoryEntry,
  TopicNamesInput,
  TopicProjectInput,
} from "@langwatch/topic-contract";

export interface TopicClusteringStatusRecord {
  projection: {
    lastRequestedAt: number | null;
    lastRequestTrigger: string | null;
    lastRunAt: number | null;
    lastRunOutcome: string | null;
    lastRunMode: string | null;
    lastRunSkippedReason: string | null;
    lastRunErrorCode: string | null;
    lastRunErrorUserActionable: boolean;
    lastRunTracesProcessed: number;
    lastRunTopicsCount: number;
    lastRunSubtopicsCount: number;
    inProgressRunId: string | null;
    inProgressStartedAt: number | null;
    occurredAt: number;
  } | null;
}

/** Private persistence capability for the Topic service. */
export abstract class TopicRepository {
  abstract findAll(input: TopicProjectInput): Promise<Topic[]>;
  abstract findNamesByIds(input: TopicNamesInput): Promise<Map<string, string>>;
  abstract findClusteringStatus(
    input: TopicProjectInput,
  ): Promise<TopicClusteringStatusRecord>;
  abstract findClusteringRunHistory(
    input: TopicProjectInput,
  ): Promise<TopicClusteringRunHistoryEntry[]>;
}
