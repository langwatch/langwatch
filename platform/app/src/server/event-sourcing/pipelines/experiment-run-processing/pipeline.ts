import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import {
  CompleteExperimentRunCommand,
  ComputeExperimentRunMetricsCommand,
  RecordEvaluatorResultCommand,
  RecordTargetResultCommand,
  StartExperimentRunCommand,
} from "./commands";
import {
  type ClickHouseExperimentRunResultRecord,
  ExperimentRunResultStorageMapProjection,
} from "./projections/experimentRunResultStorage.mapProjection";
import {
  type ExperimentRunStateData,
  ExperimentRunStateFoldProjection,
} from "./projections/experimentRunState.foldProjection";
import type { ExperimentRunProcessingEvent } from "./schemas/events";

export interface ExperimentRunProcessingPipelineDeps {
  experimentRunStateFoldStore: FoldProjectionStore<ExperimentRunStateData>;
  experimentRunItemAppendStore: AppendStore<ClickHouseExperimentRunResultRecord>;
}

/**
 * Creates the experiment run processing pipeline definition.
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
export function createExperimentRunProcessingPipeline(
  deps: ExperimentRunProcessingPipelineDeps,
) {
  const builder = definePipeline<ExperimentRunProcessingEvent>()
    .withName("experiment_run_processing")
    .withAggregateType("experiment_run")
    .withFoldProjection(
      "experimentRunState",
      new ExperimentRunStateFoldProjection({
        store: deps.experimentRunStateFoldStore,
      }),
    )
    .withMapProjection(
      "experimentRunResultStorage",
      new ExperimentRunResultStorageMapProjection({
        store: deps.experimentRunItemAppendStore,
      }),
    );

  return builder
    .withCommand("startExperimentRun", StartExperimentRunCommand)
    .withCommand("recordTargetResult", RecordTargetResultCommand)
    .withCommand("recordEvaluatorResult", RecordEvaluatorResultCommand)
    .withCommand(
      "computeExperimentRunMetrics",
      ComputeExperimentRunMetricsCommand,
    )
    .withCommand("completeExperimentRun", CompleteExperimentRunCommand)
    .build();
}
