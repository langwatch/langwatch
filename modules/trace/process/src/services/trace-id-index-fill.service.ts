import type { IdIndexFillCheckpoint, IdIndexFillReport } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";

import type { TraceIdIndexFillRepository } from "../repositories/trace-id-index-fill.repository.ts";

/**
 * The `trace:fill-id-indexes` step: fills trace's id indexes per ClickHouse target, raises their
 * retention there, then writes each index's ready marker (id-index plan §3).
 */
export class TraceIdIndexFillService {
  private constructor(
    private readonly indexes: TraceIdIndexFillRepository,
    private readonly dataRetention: DataRetentionApi,
  ) {}

  static create({
    indexes,
    dataRetention,
  }: {
    indexes: TraceIdIndexFillRepository;
    dataRetention: DataRetentionApi;
  }): TraceIdIndexFillService {
    return new TraceIdIndexFillService(indexes, dataRetention);
  }

  fill({
    checkpoint,
    dryRun,
    signal,
  }: {
    checkpoint: IdIndexFillCheckpoint;
    dryRun: boolean;
    signal: AbortSignal;
  }): Promise<IdIndexFillReport> {
    return this.indexes.fill({
      checkpoint,
      dryRun,
      signal,
      raiseRetention: (input) => this.dataRetention.raiseIdIndexRetention(input),
    });
  }
}
