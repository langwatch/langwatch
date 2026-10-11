import type { IdIndexFillCheckpoint, IdIndexFillReport } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";

import type { EvaluationRunRepository } from "../repositories/evaluation.repository.ts";

/**
 * The `evaluation:fill-id-indexes` step's body: fills the run id index from rows older than its
 * view, then per ClickHouse target raises the index's retention and writes its ready marker.
 */
export class EvaluationIdIndexFillService {
  static create(options: {
    repository: Pick<EvaluationRunRepository, "fillIdIndexes">;
    retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
  }): EvaluationIdIndexFillService {
    return new EvaluationIdIndexFillService(options);
  }

  private constructor(
    private readonly options: {
      repository: Pick<EvaluationRunRepository, "fillIdIndexes">;
      retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
    },
  ) {}

  fill({
    checkpoint,
    dryRun,
    signal,
  }: {
    checkpoint: IdIndexFillCheckpoint;
    dryRun: boolean;
    signal: AbortSignal;
  }): Promise<IdIndexFillReport> {
    return this.options.repository.fillIdIndexes({
      checkpoint,
      dryRun,
      signal,
      raiseRetention: (input) => this.options.retention.raiseIdIndexRetention(input),
    });
  }
}
