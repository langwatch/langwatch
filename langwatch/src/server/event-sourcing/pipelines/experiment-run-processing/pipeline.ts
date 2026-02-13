import { definePipeline } from "../../library";
import { CompleteExperimentRunCommand } from "./commands/completeExperimentRun.command";
import { RecordEvaluatorResultCommand } from "./commands/recordEvaluatorResult.command";
import { RecordTargetResultCommand } from "./commands/recordTargetResult.command";
import { StartExperimentRunCommand } from "./commands/startExperimentRun.command";
import { ExperimentRunResultStorageHandler } from "./handlers";
import { ExperimentRunStateProjectionHandler } from "./projections";
import { EXPERIMENT_RUN_EVENT_TYPES } from "./schemas/constants";
import type { ExperimentRunProcessingEvent } from "./schemas/events";

/**
 * Experiment run processing pipeline definition (static, no runtime dependencies).
 *
 * This pipeline uses experiment_run aggregates (aggregateId = runId).
 * It tracks the lifecycle of experiment runs:
 * - started -> target results received -> evaluator results received -> completed
 *
 * Projection: experimentRunState
 * - Computes summary statistics (progress, costs, scores, pass rate)
 * - Stored in experiment_runs ClickHouse table
 *
 * Event Handler: experimentRunResultStorage
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
    .withProjection("experimentRunState", ExperimentRunStateProjectionHandler, {
      deduplication: "aggregate",
      delay: 500,
    })
    .withEventHandler(
      "experimentRunResultStorage",
      ExperimentRunResultStorageHandler,
      {
        eventTypes: [
          EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
          EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
        ],
      },
    )
    .withCommand("startExperimentRun", StartExperimentRunCommand)
    .withCommand("recordTargetResult", RecordTargetResultCommand)
    .withCommand("recordEvaluatorResult", RecordEvaluatorResultCommand)
    .withCommand("completeExperimentRun", CompleteExperimentRunCommand)
    .build();
