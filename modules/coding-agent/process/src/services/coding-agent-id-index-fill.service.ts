import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";

import type { CodingAgentIdIndexFillRepository } from "../repositories/coding-agent-id-index-fill.repository.ts";
import { CodingAgentIdIndexFlagsService } from "./coding-agent-id-index-flags.service.ts";

/** What the step hands the fill: where it resumes, whether to write, when to stop. */
type FillRun = Pick<FillIdIndexesOptions, "checkpoint" | "dryRun" | "signal">;

/**
 * Fills the module's id indexes from rows older than their views. Per target, once every index
 * is filled, data-retention raises the index rows to each tenant's retention and only then does
 * the target's flag turn on, so no reader trusts a half-filled index.
 */
export class CodingAgentIdIndexFillService {
  static create(dependencies: {
    fills: CodingAgentIdIndexFillRepository;
    retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
    featureFlags: Pick<FeatureFlagApi, "setEnabled">;
  }): CodingAgentIdIndexFillService {
    return new CodingAgentIdIndexFillService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      fills: CodingAgentIdIndexFillRepository;
      retention: Pick<DataRetentionApi, "raiseIdIndexRetention">;
      featureFlags: Pick<FeatureFlagApi, "setEnabled">;
    },
  ) {}

  fillIdIndexes(run: FillRun): Promise<IdIndexFillReport> {
    const copied = this.dependencies.fills.indexesWithCopiedRetention();
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
          key: CodingAgentIdIndexFlagsService.keyFor({ target }),
          lastEditedBy: null,
          enabled: true,
        }),
    });
  }
}
