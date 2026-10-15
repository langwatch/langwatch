import type { TraceExistenceRepository } from "../repositories/trace-existence.repository.ts";

/**
 * Which candidate trace ids a project holds. The read is bounded by trace's id index once ready,
 * but existence is always confirmed on `trace_summaries`: an index row can outlive expired data
 * by a week or more (id-index plan §4).
 */
export class TraceExistenceService {
  private constructor(private readonly existence: TraceExistenceRepository) {}

  static create({ existence }: { existence: TraceExistenceRepository }): TraceExistenceService {
    return new TraceExistenceService(existence);
  }

  findExistingTraceIds({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: readonly string[];
  }): Promise<string[]> {
    return this.existence.findExistingTraceIds({ projectId, traceIds });
  }
}
