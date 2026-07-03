import type { SuiteAnalyticsRepository } from "~/server/app-layer/suites/repositories/suite-analytics.repository";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import { BaseAnalyticsFoldStore } from "../../shared/analyticsStoreBase";
import {
  type SuiteAnalyticsData,
  projectSuiteAnalyticsStateToRow,
  SUITE_ANALYTICS_PROJECTION_VERSION_LATEST,
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
export class SuiteAnalyticsStore extends BaseAnalyticsFoldStore<
  SuiteAnalyticsData,
  ReturnType<typeof projectSuiteAnalyticsStateToRow>
> {
  constructor(repo: SuiteAnalyticsRepository) {
    super(repo, {
      hasPersistableSignal,
      stampAggregateId: (state, aggregateId) =>
        state.suiteRunId ? state : { ...state, suiteRunId: aggregateId },
      retentionCategory: "scenarios",
      versionLatest: SUITE_ANALYTICS_PROJECTION_VERSION_LATEST,
      project: projectSuiteAnalyticsStateToRow,
    });
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
