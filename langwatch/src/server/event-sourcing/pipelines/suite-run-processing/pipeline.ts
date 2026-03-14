import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import { CompleteSuiteRunItemCommand } from "./commands/completeSuiteRunItem.command";
import { RecordSuiteRunItemStartedCommand } from "./commands/recordSuiteRunItemStarted.command";
import { StartSuiteRunCommand } from "./commands/startSuiteRun.command";
import { createSuiteRunStateFoldProjection, type SuiteRunStateData } from "./projections/suiteRunState.foldProjection";
import type { SuiteRunProcessingEvent } from "./schemas/events";

export interface SuiteRunProcessingPipelineDeps {
  suiteRunStateFoldStore: FoldProjectionStore<SuiteRunStateData>;
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
export function createSuiteRunProcessingPipeline(deps: SuiteRunProcessingPipelineDeps) {
  return definePipeline<SuiteRunProcessingEvent>()
    .withName("suite_run_processing")
    .withAggregateType("suite_run")
    .withFoldProjection("suiteRunState", createSuiteRunStateFoldProjection({
      store: deps.suiteRunStateFoldStore,
    }))
    .withCommand("startSuiteRun", StartSuiteRunCommand)
    .withCommand("recordSuiteRunItemStarted", RecordSuiteRunItemStartedCommand)
    .withCommand("completeSuiteRunItem", CompleteSuiteRunItemCommand)
    .build();
}
