import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import {
  CompleteSuiteRunItemCommand,
  RecordSuiteRunItemStartedCommand,
  StartSuiteRunCommand,
} from "./commands";
import {
  type SuiteAnalyticsData,
  SuiteAnalyticsFoldProjection,
} from "./projections/suiteAnalytics.foldProjection";
import {
  SuiteAnalyticsRollupMapProjection,
  type SuiteAnalyticsRollupRow,
} from "./projections/suiteAnalyticsRollup.mapProjection";
import {
  type SuiteRunStateData,
  SuiteRunStateFoldProjection,
} from "./projections/suiteRunState.foldProjection";
import type { SuiteRunProcessingEvent } from "./schemas/events";

export interface SuiteRunProcessingPipelineDeps {
  suiteRunStateFoldStore: FoldProjectionStore<SuiteRunStateData>;
  /** ADR-034 Phase 7: slim per-suite-run fold writer. */
  suiteAnalyticsStore: FoldProjectionStore<SuiteAnalyticsData>;
  /** ADR-034 Phase 7: per-item rollup writer. */
  suiteAnalyticsRollupAppendStore: AppendStore<SuiteAnalyticsRollupRow>;
}

/**
 * Creates the suite run processing pipeline definition.
 *
 * This pipeline uses suite_run aggregates (aggregateId = batchRunId).
 * It tracks the lifecycle of suite runs:
 * - started -> items started/completed
 *
 * Fold Projection: suiteRunState
 * - Computes summary statistics (progress, pass rate, status)
 * - Stored in suite_runs ClickHouse table
 *
 * Commands:
 * - startSuiteRun: Emits SuiteRunStartedEvent when suite run begins
 * - recordSuiteRunItemStarted: Emits SuiteRunItemStartedEvent per item
 * - completeSuiteRunItem: Emits SuiteRunItemCompletedEvent when item finishes
 *
 * No reactor on this pipeline — cross-pipeline reactors live on the simulation pipeline.
 */
export function createSuiteRunProcessingPipeline(
  deps: SuiteRunProcessingPipelineDeps,
) {
  return definePipeline<SuiteRunProcessingEvent>()
    .withName("suite_run_processing")
    .withAggregateType("suite_run")
    .withFoldProjection(
      "suiteRunState",
      new SuiteRunStateFoldProjection({
        store: deps.suiteRunStateFoldStore,
      }),
    )
    .withFoldProjection(
      "suiteAnalytics",
      new SuiteAnalyticsFoldProjection({ store: deps.suiteAnalyticsStore }),
    )
    .withMapProjection(
      "suiteAnalyticsRollup",
      new SuiteAnalyticsRollupMapProjection({
        store: deps.suiteAnalyticsRollupAppendStore,
      }),
    )
    .withCommand("startSuiteRun", StartSuiteRunCommand)
    .withCommand("recordSuiteRunItemStarted", RecordSuiteRunItemStartedCommand)
    .withCommand("completeSuiteRunItem", CompleteSuiteRunItemCommand)
    .build();
}
