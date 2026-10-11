import type { IdIndexFillCheckpoint, IdIndexFillReport } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { type FeatureFlagApi, idIndexFlagKey } from "@langwatch/feature-flag-contract";

import type { AnalyticsEvaluationRepository } from "../repositories/analytics-persistence.repository.ts";

/**
 * The `analytics:fill-id-indexes` step's body: fills the evaluation id index from rows older
 * than its view, then per ClickHouse target raises its retention and sets the target's flag.
 */
export class AnalyticsIdIndexFillService {
  static create(options: {
    repository: Pick<AnalyticsEvaluationRepository, "fillIdIndexes">;
    flags: Pick<FeatureFlagApi, "setEnabled">;
    retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
  }): AnalyticsIdIndexFillService {
    return new AnalyticsIdIndexFillService(options);
  }

  private constructor(
    private readonly options: {
      repository: Pick<AnalyticsEvaluationRepository, "fillIdIndexes">;
      flags: Pick<FeatureFlagApi, "setEnabled">;
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
      beforeFlag: async ({ target, indexes }) => {
        if (indexes.length === 0) return;
        await this.options.retention.raiseIdIndexRetention({
          organizationId: target.organizationId,
          indexes: [...indexes],
        });
      },
      setFlag: ({ target }) =>
        this.options.flags.setEnabled({
          key: idIndexFlagKey({ owner: "analytics", target }),
          lastEditedBy: null,
          enabled: true,
        }),
    });
  }
}
