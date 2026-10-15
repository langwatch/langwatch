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
export interface TopicRepository {
  findAll(input: TopicProjectInput): Promise<Topic[]>;
  findNamesByIds(input: TopicNamesInput): Promise<Map<string, string>>;
  findClusteringStatus(input: TopicProjectInput): Promise<TopicClusteringStatusRecord>;
  findClusteringRunHistory(input: TopicProjectInput): Promise<TopicClusteringRunHistoryEntry[]>;
}
