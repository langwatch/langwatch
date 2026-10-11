import type { IdIndexFillCheckpoint, IdIndexFillReport } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";

import type { AnalyticsEvaluationRepository } from "../repositories/analytics-persistence.repository.ts";

/**
 * The `analytics:fill-id-indexes` step's body: fills the evaluation id index from rows older
 * than its view, then per ClickHouse target raises its retention and writes its ready marker.
 */
export class AnalyticsIdIndexFillService {
  static create(options: {
    repository: Pick<AnalyticsEvaluationRepository, "fillIdIndexes">;
    retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
  }): AnalyticsIdIndexFillService {
    return new AnalyticsIdIndexFillService(options);
  }

  private constructor(
    private readonly options: {
      repository: Pick<AnalyticsEvaluationRepository, "fillIdIndexes">;
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
