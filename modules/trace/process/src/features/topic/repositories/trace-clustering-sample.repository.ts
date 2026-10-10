/** One trace_summaries row at its latest version, as topic clustering pages them. */
export interface TraceClusteringSampleRow {
  traceId: string;
  computedInput: string | null;
  topicId: string | null;
  subtopicId: string | null;
  occurredAtMs: number;
}

export interface TraceClusteringSampleCounts {
  total: number;
  recent: number;
  assigned: number;
}

/** The trace reads topic clustering runs, over trace's own summaries. */
export abstract class TraceClusteringSampleRepository {
  abstract countTraces(input: {
    tenantId: string;
    recentSinceMs: number;
    windowStartMs: number;
  }): Promise<TraceClusteringSampleCounts>;

  /** At most 2000 traces, unordered: the caller sorts, because the query must not buffer. */
  abstract findPageRows(input: {
    tenantId: string;
    windowStartMs: number;
    unassignedFrom?: { topicIds: readonly string[]; subtopicIds: readonly string[] };
    searchAfter?: readonly [number, string];
  }): Promise<TraceClusteringSampleRow[]>;
}
