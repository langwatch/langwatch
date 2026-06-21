import type { SuiteAnalyticsRollupRepository } from "~/server/app-layer/suites/repositories/suite-analytics-rollup.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { SuiteAnalyticsRollupRow } from "./suiteAnalyticsRollup.mapProjection";

/**
 * Thin AppendStore adapter for `suite_analytics_rollup` (ADR-034 Phase 7).
 */
export class SuiteAnalyticsRollupAppendStore
  implements AppendStore<SuiteAnalyticsRollupRow>
{
  constructor(private readonly repo: SuiteAnalyticsRollupRepository) {}

  async append(
    record: SuiteAnalyticsRollupRow,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const retentionDays =
      context.retentionPolicy?.scenarios ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    await this.repo.insertRow(record, retentionDays);
  }
}
