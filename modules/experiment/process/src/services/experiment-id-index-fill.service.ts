import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { type FeatureFlagApi, idIndexFlagKey } from "@langwatch/feature-flag-contract";

import type { ExperimentIdIndexFillRepository } from "../repositories/experiment-id-index-fill.repository.ts";
import { EXPERIMENT_ID_INDEX_OWNER } from "./experiment-id-index-flags.service.ts";

/** What the step hands the fill: where it resumes, whether to write, when to stop. */
type FillRun = Pick<FillIdIndexesOptions, "checkpoint" | "dryRun" | "signal">;

/**
 * Fills the module's id indexes from rows older than their views. Per target, once every index
 * is filled, data-retention raises the index rows to each tenant's retention and only then does
 * the target's flag turn on, so no reader trusts a half-filled index.
 */
export class ExperimentIdIndexFillService {
  static create(dependencies: {
    fills: ExperimentIdIndexFillRepository;
    retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
    featureFlags: Pick<FeatureFlagApi, "setEnabled">;
  }): ExperimentIdIndexFillService {
    return new ExperimentIdIndexFillService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      fills: ExperimentIdIndexFillRepository;
      retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
      featureFlags: Pick<FeatureFlagApi, "setEnabled">;
    },
  ) {}

  fillIdIndexes(run: FillRun): Promise<IdIndexFillReport> {
    const copied = this.dependencies.fills.indexes
      .filter((each) => each.retention === "copied")
      .map((each) => each.index);
    return this.dependencies.fills.fill({
      ...run,
      beforeFlag: async ({ target }) => {
        if (copied.length === 0) return;
        await this.dependencies.retention.raiseIdIndexRetention({
          ...(target.organizationId === undefined ? {} : { organizationId: target.organizationId }),
          indexes: copied,
        });
      },
      setFlag: ({ target }) =>
        this.dependencies.featureFlags.setEnabled({
          key: idIndexFlagKey({ owner: EXPERIMENT_ID_INDEX_OWNER, target }),
          lastEditedBy: null,
          enabled: true,
        }),
    });
  }
}
