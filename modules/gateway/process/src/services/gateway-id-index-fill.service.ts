import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";

import type { GatewayIdIndexFillRepository } from "../repositories/gateway-id-index-fill.repository.ts";
import { GatewayIdIndexFlagsService } from "./gateway-id-index-flags.service.ts";

/** What the step hands the fill: where it resumes, whether to write, when to stop. */
type FillRun = Pick<FillIdIndexesOptions, "checkpoint" | "dryRun" | "signal">;

/**
 * Fills the module's id indexes from rows older than their views, then turns each filled
 * target's flag on. No source carries a retention, so nothing is raised before the flag.
 */
export class GatewayIdIndexFillService {
  static create(dependencies: {
    fills: GatewayIdIndexFillRepository;
    featureFlags: Pick<FeatureFlagApi, "setEnabled">;
  }): GatewayIdIndexFillService {
    return new GatewayIdIndexFillService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      fills: GatewayIdIndexFillRepository;
      featureFlags: Pick<FeatureFlagApi, "setEnabled">;
    },
  ) {}

  fillIdIndexes(run: FillRun): Promise<IdIndexFillReport> {
    return this.dependencies.fills.fill({
      ...run,
      beforeFlag: () => Promise.resolve(),
      setFlag: ({ target }) =>
        this.dependencies.featureFlags.setEnabled({
          key: GatewayIdIndexFlagsService.keyFor({ target }),
          lastEditedBy: null,
          enabled: true,
        }),
    });
  }
}
