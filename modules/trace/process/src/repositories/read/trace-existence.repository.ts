import type { TraceUsageCount } from "@langwatch/trace-contract";

/**
 * Which of a set of candidate ids the project actually holds a trace for.
 * The one question other verticals ask without wanting a trace: annotation
 * queueing and handoff automation need to know an id resolves before writing.
 */
export abstract class TraceExistenceRepository {
  abstract findExistingTraceIds(input: {
    projectId: string;
    traceIds: readonly string[];
  }): Promise<string[]>;

  /** The usage report's counts, one project at a time and added up. */
  abstract countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<TraceUsageCount>;
}
