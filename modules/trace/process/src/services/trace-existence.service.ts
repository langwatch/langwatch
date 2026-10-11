import type { IdIndexFlags } from "@langwatch/clickhouse-client";

import type { TraceExistenceRepository } from "../repositories/trace-existence.repository.ts";
import type { TraceIdIndexReadRepository } from "../repositories/trace-id-index-read.repository.ts";

/**
 * Which candidate trace ids a project holds. With trace's id index ready, the index names the
 * range the read is bounded to, but existence is always confirmed on `trace_summaries`: an index
 * row can outlive expired data by a week or more (id-index plan §4).
 */
export class TraceExistenceService {
  private constructor(
    private readonly existence: TraceExistenceRepository,
    private readonly idIndexReads: TraceIdIndexReadRepository,
    private readonly idIndex: IdIndexFlags | undefined,
  ) {}

  static create({
    existence,
    idIndexReads,
    idIndex,
  }: {
    existence: TraceExistenceRepository;
    idIndexReads: TraceIdIndexReadRepository;
    idIndex?: IdIndexFlags | undefined;
  }): TraceExistenceService {
    return new TraceExistenceService(existence, idIndexReads, idIndex);
  }

  async findExistingTraceIds({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: readonly string[];
  }): Promise<string[]> {
    const [window] = await this.idIndexReads.findWindows({
      tenantId: projectId,
      traceIds,
      source: "trace_summaries",
      idIndex: this.idIndex,
    });
    return this.existence.findExistingTraceIds({ projectId, traceIds, window });
  }
}
