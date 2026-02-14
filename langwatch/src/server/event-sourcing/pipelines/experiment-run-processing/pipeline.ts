import { definePipeline } from "../../library";
import { CompleteExperimentRunCommand } from "./commands/completeExperimentRun.command";
import { RecordEvaluatorResultCommand } from "./commands/recordEvaluatorResult.command";
import { RecordTargetResultCommand } from "./commands/recordTargetResult.command";
import { StartExperimentRunCommand } from "./commands/startExperimentRun.command";
import { experimentRunResultStorageMapProjection } from "./handlers/experimentRunResultStorage.mapProjection";
import { experimentRunStateFoldProjection } from "./projections/experimentRunState.foldProjection";
import type { ExperimentRunProcessingEvent } from "./schemas/events";

/**
 * Experiment run processing pipeline definition (static, no runtime dependencies).
 *
 * This pipeline uses experiment_run aggregates (aggregateId = runId).
 * It tracks the lifecycle of experiment runs:
 * - started -> target results received -> evaluator results received -> completed
 *
 * Fold Projection: experimentRunState
 * - Computes summary statistics (progress, costs, scores, pass rate)
 * - Stored in experiment_runs ClickHouse table
 *
 * Map Projection: experimentRunResultStorage
 * - Writes individual results to experiment_run_items for query-optimized access
 * - Enables efficient filtering/sorting of detailed results
 *
 * Commands:
 * - startExperimentRun: Emits ExperimentRunStartedEvent when run begins
 * - recordTargetResult: Emits TargetResultEvent per row/target
 * - recordEvaluatorResult: Emits EvaluatorResultEvent per row/evaluator
 * - completeExperimentRun: Emits ExperimentRunCompletedEvent when run finishes
 */
export const experimentRunProcessingPipelineDefinition =
  definePipeline<ExperimentRunProcessingEvent>()
    .withName("experiment_run_processing")
    .withAggregateType("experiment_run")
    .withFoldProjection("experimentRunState", experimentRunStateFoldProjection, {
      deduplication: "aggregate",
      delay: 500,
    })
    .withMapProjection(
      "experimentRunResultStorage",
      experimentRunResultStorageMapProjection,
    )
    .withCommand("startExperimentRun", StartExperimentRunCommand)
    .withCommand("recordTargetResult", RecordTargetResultCommand)
    .withCommand("recordEvaluatorResult", RecordEvaluatorResultCommand)
    .withCommand("completeExperimentRun", CompleteExperimentRunCommand)
    .build();
