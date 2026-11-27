/** How many of a project's traces topic clustering sees, and how many carry a topic. */
export interface TraceTopicClusteringCounts {
  totalTracesCount: number;
  recentTracesCount: number;
  assignedTracesCount: number;
}

/** One trace as clustering reads it: its input text, and its topic when the caller knows it. */
export interface TraceTopicClusteringTrace {
  trace_id: string;
  input: string;
  topic_id: string | null;
  subtopic_id: string | null;
}

export interface TraceTopicClusteringPageInput {
  projectId: string;
  isIncrementalProcessing: boolean;
  topicIds: readonly string[];
  subtopicIds: readonly string[];
  searchAfter?: readonly [number, string];
  /** Only traces that occurred at or after this instant; an incremental run's watermark. */
  occurredSinceMs?: number;
  /** Only traces that occurred before this instant; defaults to now. */
  occurredBeforeMs?: number;
}

export interface TraceTopicClusteringPage {
  traces: TraceTopicClusteringTrace[];
  lastSort: [number, string] | undefined;
  returnedCount: number;
  /** Each returned trace's own OccurredAt, so its topic assignment folds at the trace's time. */
  occurredAtMsByTraceId: Record<string, number>;
}
