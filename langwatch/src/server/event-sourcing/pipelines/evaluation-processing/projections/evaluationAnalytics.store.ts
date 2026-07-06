import type { EvaluationAnalyticsRepository } from "~/server/app-layer/evaluations/repositories/evaluation-analytics.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  type EvaluationAnalyticsData,
  projectEvaluationAnalyticsStateToRow,
} from "./evaluationAnalytics.foldProjection";

/**
 * `FoldProjectionStore` adapter for the slim `evaluation_analytics` fold
 * (ADR-034 Phase 6 — eval mirror of `TraceAnalyticsStore`).
 *
 * Skips empty rows (no terminal status seen yet, evaluationId still ''),
 * falls back to the aggregateId when the state has no evaluationId, stamps
 * the per-tenant retention onto the record, and projects the in-memory
 * `EvaluationAnalyticsData` accumulator into the slim row at write time.
 *
 * The slim row is derived deterministically from a fold state whose
 * handlers mirror the `EvaluationRunFoldProjection` for the shared fields,
 * so the persisted hoisted-dim columns (Status / Score / Passed / Label /
 * EvaluatorType / TraceId / IsGuardrail) match `evaluation_runs` to the
 * cent for the SAME evaluation. The slim Attributes map is trimmed by
 * `trimAttributesForAnalytics` inside the projection function so
 * payload-shaped keys never reach the wire.
 */
export class EvaluationAnalyticsStore
  implements FoldProjectionStore<EvaluationAnalyticsData>
{
  constructor(private readonly repo: EvaluationAnalyticsRepository) {}

  async store(
    state: EvaluationAnalyticsData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (!hasPersistableSignal(state)) return;
    const stateWithId: EvaluationAnalyticsData = state.evaluationId
      ? state
      : { ...state, evaluationId: String(context.aggregateId) };
    const retentionDays =
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    const row = projectEvaluationAnalyticsStateToRow({
      state: stateWithId,
      tenantId: String(context.tenantId),
      version: EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
    });
    await this.repo.upsert(row, retentionDays);
  }

  async storeBatch(
    entries: Array<{
      state: EvaluationAnalyticsData;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    const batchRows = entries
      .filter(({ state }) => hasPersistableSignal(state))
      .map(({ state, context }) => {
        const stateWithId: EvaluationAnalyticsData = state.evaluationId
          ? state
          : { ...state, evaluationId: String(context.aggregateId) };
        return {
          row: projectEvaluationAnalyticsStateToRow({
            state: stateWithId,
            tenantId: String(context.tenantId),
            version: EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
          }),
          retentionDays:
            context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
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
   * Phase 6 has no slim read-back path — the executor always re-folds from
   * the event log when the slim cache misses, rather than reading slim
   * back. Same Phase 2/3 contract the trace slim store applies.
   */
  async get(
    _aggregateId: string,
    _context: ProjectionStoreContext,
  ): Promise<EvaluationAnalyticsData | null> {
    return null;
  }
}

/**
 * Skip rows that have no observable signal yet — the fold may have run
 * once with a half-formed scheduled-only state. Persisting it would churn
 * the slim table for evaluations that never reach a terminal status.
 *
 * "Signal" = at least one of: terminal status reached, identity stamped
 * via `EvaluationReportedEvent` (which sets evaluatorType on its own), or
 * a non-empty evaluatorId from any earlier event. The conservative branch
 * (no evaluationId) is always a no-op so the store cannot persist a row
 * whose primary key is empty.
 */
function hasPersistableSignal(state: EvaluationAnalyticsData): boolean {
  if (!state.evaluationId && !state.evaluatorId) return false;
  return true;
}
