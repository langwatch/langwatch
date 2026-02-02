import { definePipeline } from "../../library";
import { CompleteExperimentRunCommand } from "./commands/completeExperimentRun.command";
import { RecordEvaluatorResultCommand } from "./commands/recordEvaluatorResult.command";
import { RecordTargetResultCommand } from "./commands/recordTargetResult.command";
import { StartExperimentRunCommand } from "./commands/startExperimentRun.command";
import { ExperimentRunResultStorageHandler } from "./handlers";
import { ExperimentRunStateProjectionHandler } from "./projections";
import {
  EVALUATOR_RESULT_EVENT_TYPE,
  TARGET_RESULT_EVENT_TYPE,
} from "./schemas/constants";
import type { ExperimentRunProcessingEvent } from "./schemas/events";

/**
 * Experiment run processing pipeline definition (static, no runtime dependencies).
 *
 * This pipeline uses experiment_run aggregates (aggregateId = runId).
 * It tracks the lifecycle of experiment runs (evaluations-v3 feature):
 * - started -> target results received -> evaluator results received -> completed
 *
 * Projection: experimentRunState
 * - Computes summary statistics (progress, costs, scores, pass rate)
 * - Stored in batch_evaluation_runs ClickHouse table
 *
 * Event Handler: experimentRunResultStorage
 * - Writes individual results to batch_evaluation_results for query-optimized access
 * - Enables efficient filtering/sorting of detailed results
 *
 * Commands:
 * - startExperimentRun: Emits ExperimentRunStartedEvent when run begins
 * - recordTargetResult: Emits TargetResultEvent per row/target
 * - recordEvaluatorResult: Emits EvaluatorResultEvent per row/evaluator
 * - completeExperimentRun: Emits ExperimentRunCompletedEvent when run finishes
 *
 * This is a static definition that can be safely imported without triggering
 * ClickHouse/Redis connections. It gets registered with the runtime in
 * the eventSourcing.ts file.
 */
export const experimentRunProcessingPipelineDefinition =
  definePipeline<ExperimentRunProcessingEvent>()
    .withName("experiment_run_processing")
    .withAggregateType("experiment_run")
    .withProjection(
      "experimentRunState",
      ExperimentRunStateProjectionHandler,
      {
        // Dedupe by aggregate to process only the latest event per run
        deduplication: "aggregate",
        // Balance of real-time feel + batching; projection is lightweight
        delay: 500,
      },
    )
    .withEventHandler(
      "experimentRunResultStorage",
      ExperimentRunResultStorageHandler,
      {
        eventTypes: [TARGET_RESULT_EVENT_TYPE, EVALUATOR_RESULT_EVENT_TYPE],
      },
    )
    .withCommand("startExperimentRun", StartExperimentRunCommand)
    .withCommand("recordTargetResult", RecordTargetResultCommand)
    .withCommand("recordEvaluatorResult", RecordEvaluatorResultCommand)
    .withCommand("completeExperimentRun", CompleteExperimentRunCommand)
    .build();
