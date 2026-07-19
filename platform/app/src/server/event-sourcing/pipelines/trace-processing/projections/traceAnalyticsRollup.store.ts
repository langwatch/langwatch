import type { TraceAnalyticsRollupRepository } from "~/server/app-layer/traces/repositories/trace-analytics-rollup.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { TraceAnalyticsRollupRow } from "./traceAnalyticsRollup.mapProjection";

/**
 * Thin AppendStore adapter for the trace_analytics_rollup map projection
 * (ADR-034 Phase 1). Pulls per-tenant retention off the context and stamps it
 * onto the row's `_retention_days` column, then delegates to the repository.
 */
export class TraceAnalyticsRollupAppendStore
  implements AppendStore<TraceAnalyticsRollupRow>
{
  constructor(private readonly repo: TraceAnalyticsRollupRepository) {}

  async append(
    record: TraceAnalyticsRollupRow,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const retentionDays =
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    await this.repo.insertRow(record, retentionDays);
  }
}
