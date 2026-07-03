import type { EvaluationAnalyticsRollupRepository } from "~/server/app-layer/evaluations/repositories/evaluation-analytics-rollup.repository";
import { BaseAnalyticsRollupAppendStore } from "../../shared/analyticsStoreBase";
import type { EvaluationAnalyticsRollupRow } from "./evaluationAnalyticsRollup.mapProjection";

/**
 * Thin AppendStore adapter for the `evaluation_analytics_rollup` map
 * projection (ADR-034 Phase 6 — eval mirror of
 * `TraceAnalyticsRollupAppendStore`). Pulls per-tenant retention off the
 * context and stamps it onto the row's `_retention_days` column, then
 * delegates to the repository.
 */
export class EvaluationAnalyticsRollupAppendStore extends BaseAnalyticsRollupAppendStore<EvaluationAnalyticsRollupRow> {
  constructor(repo: EvaluationAnalyticsRollupRepository) {
    super(repo, { retentionCategory: "traces" });
  }
}
