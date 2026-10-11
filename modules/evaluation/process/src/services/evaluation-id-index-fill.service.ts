import type { IdIndexFillCheckpoint, IdIndexFillReport } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { type FeatureFlagApi, idIndexFlagKey } from "@langwatch/feature-flag-contract";

import type { EvaluationRunRepository } from "../repositories/evaluation.repository.ts";

/**
 * The `evaluation:fill-id-indexes` step's body: fills the run id index from rows older than its
 * view, then per ClickHouse target raises the index's retention and sets the target's flag.
 */
export class EvaluationIdIndexFillService {
  static create(options: {
    repository: Pick<EvaluationRunRepository, "fillIdIndexes">;
    flags: Pick<FeatureFlagApi, "setEnabled">;
    retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
  }): EvaluationIdIndexFillService {
    return new EvaluationIdIndexFillService(options);
  }

  private constructor(
    private readonly options: {
      repository: Pick<EvaluationRunRepository, "fillIdIndexes">;
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
          key: idIndexFlagKey({ owner: "evaluation", target }),
          lastEditedBy: null,
          enabled: true,
        }),
    });
  }
}
