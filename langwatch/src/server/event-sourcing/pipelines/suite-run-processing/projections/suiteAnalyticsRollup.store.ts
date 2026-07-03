import type { SuiteAnalyticsRollupRepository } from "~/server/app-layer/suites/repositories/suite-analytics-rollup.repository";
import { BaseAnalyticsRollupAppendStore } from "../../shared/analyticsStoreBase";
import type { SuiteAnalyticsRollupRow } from "./suiteAnalyticsRollup.mapProjection";

/**
 * Thin AppendStore adapter for `suite_analytics_rollup` (ADR-034 Phase 7).
 */
export class SuiteAnalyticsRollupAppendStore extends BaseAnalyticsRollupAppendStore<SuiteAnalyticsRollupRow> {
  constructor(repo: SuiteAnalyticsRollupRepository) {
    super(repo, { retentionCategory: "scenarios" });
  }
}
