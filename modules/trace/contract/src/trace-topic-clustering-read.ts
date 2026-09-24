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
}

export interface TraceTopicClusteringPage {
  traces: TraceTopicClusteringTrace[];
  lastSort: [number, string] | undefined;
  returnedCount: number;
}
