import type { SimulationAnalyticsRollupRepository } from "~/server/app-layer/scenarios/repositories/simulation-analytics-rollup.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { SimulationAnalyticsRollupRow } from "./simulationAnalyticsRollup.mapProjection";

/**
 * Thin AppendStore adapter for the `simulation_analytics_rollup` map
 * projection (ADR-034 Phase 7 — scenarios mirror of
 * `TraceAnalyticsRollupAppendStore` / `EvaluationAnalyticsRollupAppendStore`).
 * Pulls per-tenant retention off the context and stamps it onto the row's
 * `_retention_days` column, then delegates to the repository.
 */
export class SimulationAnalyticsRollupAppendStore
  implements AppendStore<SimulationAnalyticsRollupRow>
{
  constructor(private readonly repo: SimulationAnalyticsRollupRepository) {}

  async append(
    record: SimulationAnalyticsRollupRow,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const retentionDays =
      context.retentionPolicy?.scenarios ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    await this.repo.insertRow(record, retentionDays);
  }
}
