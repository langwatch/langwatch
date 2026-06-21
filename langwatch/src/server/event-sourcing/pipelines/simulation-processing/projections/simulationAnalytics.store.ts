import type { SimulationAnalyticsRepository } from "~/server/app-layer/scenarios/repositories/simulation-analytics.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import {
  type SimulationAnalyticsData,
  projectSimulationAnalyticsStateToRow,
  SIMULATION_ANALYTICS_PROJECTION_VERSION_LATEST,
} from "./simulationAnalytics.foldProjection";

/**
 * `FoldProjectionStore` adapter for the slim `simulation_analytics` fold
 * (ADR-034 Phase 7 — scenarios mirror of `TraceAnalyticsStore` /
 * `EvaluationAnalyticsStore`).
 *
 * Skips empty rows (no scenarioRunId stamped yet), falls back to the
 * aggregateId when the state has no scenarioRunId, stamps the per-tenant
 * retention onto the record, and projects the in-memory
 * `SimulationAnalyticsData` accumulator into the slim row at write time.
 */
export class SimulationAnalyticsStore
  implements FoldProjectionStore<SimulationAnalyticsData>
{
  constructor(private readonly repo: SimulationAnalyticsRepository) {}

  async store(
    state: SimulationAnalyticsData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (!hasPersistableSignal(state)) return;
    const stateWithId: SimulationAnalyticsData = state.scenarioRunId
      ? state
      : { ...state, scenarioRunId: String(context.aggregateId) };
    const retentionDays =
      context.retentionPolicy?.scenarios ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    const row = projectSimulationAnalyticsStateToRow({
      state: stateWithId,
      tenantId: String(context.tenantId),
      version: SIMULATION_ANALYTICS_PROJECTION_VERSION_LATEST,
    });
    await this.repo.upsert(row, retentionDays);
  }

  async storeBatch(
    entries: Array<{
      state: SimulationAnalyticsData;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    const batchRows = entries
      .filter(({ state }) => hasPersistableSignal(state))
      .map(({ state, context }) => {
        const stateWithId: SimulationAnalyticsData = state.scenarioRunId
          ? state
          : { ...state, scenarioRunId: String(context.aggregateId) };
        return {
          row: projectSimulationAnalyticsStateToRow({
            state: stateWithId,
            tenantId: String(context.tenantId),
            version: SIMULATION_ANALYTICS_PROJECTION_VERSION_LATEST,
          }),
          retentionDays:
            context.retentionPolicy?.scenarios ??
            PLATFORM_DEFAULT_RETENTION_DAYS,
        };
      });

    if (batchRows.length === 0) return;

    if (this.repo.upsertBatch) {
      await this.repo.upsertBatch(batchRows);
    } else {
      await Promise.all(
        batchRows.map(({ row, retentionDays }) =>
          this.repo.upsert(row, retentionDays),
        ),
      );
    }
  }

  /**
   * Phase 7 has no slim read-back path — the executor always re-folds from
   * the event log when the slim cache misses, rather than reading slim
   * back. Same contract the trace + eval slim stores apply.
   */
  async get(
    _aggregateId: string,
    _context: ProjectionStoreContext,
  ): Promise<SimulationAnalyticsData | null> {
    return null;
  }
}

/**
 * Skip rows whose state has no observable signal yet — the fold may have run
 * once with a half-formed pre-queued state. Persisting it would churn the
 * slim table for runs that never reach a terminal status.
 *
 * The conservative branch (no scenarioRunId) is always a no-op so the store
 * cannot persist a row whose primary key is empty.
 */
function hasPersistableSignal(state: SimulationAnalyticsData): boolean {
  if (!state.scenarioRunId) return false;
  return true;
}
