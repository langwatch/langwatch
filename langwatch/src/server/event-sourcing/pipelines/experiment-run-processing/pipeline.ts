import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import { CompleteExperimentRunCommand } from "./commands/completeExperimentRun.command";
import { RecordEvaluatorResultCommand } from "./commands/recordEvaluatorResult.command";
import { RecordTargetResultCommand } from "./commands/recordTargetResult.command";
import { StartExperimentRunCommand } from "./commands/startExperimentRun.command";
import { createExperimentRunResultStorageMapProjection, type ClickHouseExperimentRunResultRecord } from "./projections/experimentRunResultStorage.mapProjection";
import { createExperimentRunStateFoldProjection, type ExperimentRunStateData } from "./projections/experimentRunState.foldProjection";
import type { ExperimentRunProcessingEvent } from "./schemas/events";

export interface ExperimentRunProcessingPipelineDeps {
  experimentRunStateFoldStore: FoldProjectionStore<ExperimentRunStateData>;
  experimentRunItemAppendStore: AppendStore<ClickHouseExperimentRunResultRecord>;
  esSync?: ReactorDefinition<ExperimentRunProcessingEvent, ExperimentRunStateData>;
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
export function createExperimentRunProcessingPipeline(deps: ExperimentRunProcessingPipelineDeps) {
  const builder = definePipeline<ExperimentRunProcessingEvent>()
    .withName("experiment_run_processing")
    .withAggregateType("experiment_run")
    .withFoldProjection("experimentRunState", createExperimentRunStateFoldProjection({
      store: deps.experimentRunStateFoldStore,
    }))
    .withMapProjection("experimentRunResultStorage", createExperimentRunResultStorageMapProjection({
      store: deps.experimentRunItemAppendStore,
    }));

  if (deps.esSync) {
    builder.withReactor("experimentRunState", "experimentRunEsSync", deps.esSync);
  }

  return builder
    .withCommand("startExperimentRun", StartExperimentRunCommand)
    .withCommand("recordTargetResult", RecordTargetResultCommand)
    .withCommand("recordEvaluatorResult", RecordEvaluatorResultCommand)
    .withCommand("completeExperimentRun", CompleteExperimentRunCommand)
    .build();
}
