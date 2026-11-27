import type { TraceCost, TracePresence, TraceUsageCount } from "@langwatch/trace-contract";

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

  /** Which of these projects hold this trace id, as a summary or as stored spans. */
  abstract findProjectsHoldingTrace(input: {
    projectIds: readonly string[];
    traceId: string;
  }): Promise<string[]>;

  /** The latest summary cost of each named trace inside the window; unknown ids are absent. */
  abstract findTraceCosts(input: {
    projectId: string;
    traceIds: readonly string[];
    occurredAt: { from: number; to: number };
  }): Promise<TraceCost[]>;

  /** The usage report's counts, one project at a time and added up. */
  abstract countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<TraceUsageCount>;

  /** Each asked project's distinct traces that occurred in `[since, until)`, and the latest one. */
  abstract countTracesByProject(input: {
    projectIds: readonly string[];
    since: number;
    until: number;
  }): Promise<TraceProjectCount[]>;

  /** The trace's stored spans in one project: counts and arrival times, empty when absent. */
  abstract findTracePresence(input: {
    projectId: string;
    traceId: string;
  }): Promise<TracePresence[]>;
}

/** One project's traces over a range; `lastTraceAt` is null when none occurred. */
export type TraceProjectCount = Readonly<{
  projectId: string;
  traces: number;
  lastTraceAt: number | null;
}>;
