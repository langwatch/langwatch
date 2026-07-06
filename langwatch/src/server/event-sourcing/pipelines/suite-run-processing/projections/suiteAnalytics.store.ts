import type { SuiteAnalyticsRepository } from "~/server/app-layer/suites/repositories/suite-analytics.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import {
  projectSuiteAnalyticsStateToRow,
  SUITE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type SuiteAnalyticsData,
} from "./suiteAnalytics.foldProjection";

/**
 * `FoldProjectionStore` adapter for the slim `suite_analytics` fold (ADR-034
 * Phase 7).
 *
 * The suite-run aggregateId is the SuiteRunId, so the store stamps it from
 * the context when the in-memory state hasn't yet recorded one.
 *
 * Suites use the `scenarios` retention category — `suite_runs` is mapped to
 * `scenarios` in `RETENTION_TABLE_CATEGORY_MAP` and `suite_analytics`
 * mirrors that.
 */
export class SuiteAnalyticsStore
  implements FoldProjectionStore<SuiteAnalyticsData>
{
  constructor(private readonly repo: SuiteAnalyticsRepository) {}

  async store(
    state: SuiteAnalyticsData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (!hasPersistableSignal(state, context)) return;
    const stateWithId: SuiteAnalyticsData = state.suiteRunId
      ? state
      : { ...state, suiteRunId: String(context.aggregateId) };
    const retentionDays =
      context.retentionPolicy?.scenarios ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    const row = projectSuiteAnalyticsStateToRow({
      state: stateWithId,
      tenantId: String(context.tenantId),
      version: SUITE_ANALYTICS_PROJECTION_VERSION_LATEST,
    });
    await this.repo.upsert(row, retentionDays);
  }

  async storeBatch(
    entries: Array<{
      state: SuiteAnalyticsData;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    const batchRows = entries
      .filter(({ state, context }) => hasPersistableSignal(state, context))
      .map(({ state, context }) => {
        const stateWithId: SuiteAnalyticsData = state.suiteRunId
          ? state
          : { ...state, suiteRunId: String(context.aggregateId) };
        return {
          row: projectSuiteAnalyticsStateToRow({
            state: stateWithId,
            tenantId: String(context.tenantId),
            version: SUITE_ANALYTICS_PROJECTION_VERSION_LATEST,
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

  async get(
    _aggregateId: string,
    _context: ProjectionStoreContext,
  ): Promise<SuiteAnalyticsData | null> {
    return null;
  }
}

function hasPersistableSignal(
  state: SuiteAnalyticsData,
  context: ProjectionStoreContext,
): boolean {
  // Skip rows whose state has no observable id at all — the fold may have run
  // once with a pre-started empty state. The aggregateId is always available
  // via the context, so this only triggers when the framework hasn't bound
  // one yet.
  if (!state.suiteRunId && !context.aggregateId) return false;
  return true;
}
