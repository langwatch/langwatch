import type { TraceCost, TraceUsageCount } from "@langwatch/trace-contract";

import type { TraceIdIndexWindow } from "./trace-id-index-read.repository.ts";

/**
 * Which of a set of candidate ids the project actually holds a trace for.
 * The one question other verticals ask without wanting a trace: annotation
 * queueing and handoff automation need to know an id resolves before writing.
 */
export abstract class TraceExistenceRepository {
  abstract findExistingTraceIds(input: {
    projectId: string;
    traceIds: readonly string[];
    /** The id index's range for these ids: bounds the read, which still confirms on the source. */
    window?: TraceIdIndexWindow | undefined;
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
}
