import type { TraceAnalyticsRollupRepository } from "~/server/app-layer/traces/repositories/trace-analytics-rollup.repository";
import { BaseAnalyticsRollupAppendStore } from "../../shared/analyticsStoreBase";
import type { TraceAnalyticsRollupRow } from "./traceAnalyticsRollup.mapProjection";

/**
 * Thin AppendStore adapter for the trace_analytics_rollup map projection
 * (ADR-099 Phase 1). Pulls per-tenant retention off the context and stamps it
 * onto the row's `_retention_days` column, then delegates to the repository.
 */
export class TraceAnalyticsRollupAppendStore extends BaseAnalyticsRollupAppendStore<TraceAnalyticsRollupRow> {
  constructor(repo: TraceAnalyticsRollupRepository) {
    super(repo, { retentionCategory: "traces" });
  }
}
