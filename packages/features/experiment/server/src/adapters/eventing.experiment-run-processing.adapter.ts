import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import {
  CompleteExperimentRunCommand,
  ComputeExperimentRunMetricsCommand,
  RecordEvaluatorResultCommand,
  RecordTargetResultCommand,
  StartExperimentRunCommand,
} from "./eventing.experiment-run-commands.adapter";
import {
  type ClickHouseExperimentRunResultRecord,
  ExperimentRunResultStorageMapProjection,
} from "../projections/experiment-run-result-storage.projection";
import {
  type ExperimentRunStateData,
  ExperimentRunStateFoldProjection,
} from "../projections/experiment-run-state.projection";
import { EXPERIMENT_RUN_PROCESSING_EVENT_TYPES } from "./eventing.experiment-run-event-types.adapter";
import type { ExperimentRunProcessingEvent } from "./eventing.experiment-run-events.adapter";
import {
  ExperimentClickHouseAdapter,
  type ExperimentEventingClickHouseResolver,
} from "./experiment-clickhouse.adapter";
import {
  ExperimentIdLookupClickHouseRepository,
  NullExperimentIdLookupRepository,
  type ExperimentIdLookup,
} from "../repositories/clickhouse/clickhouse.experiment-id-lookup.repository";
import { ExperimentRunStateRepositoryClickHouse } from "../repositories/clickhouse/clickhouse.experiment-run-state.repository";
import { ExperimentRunStateRepositoryMemory } from "../repositories/memory/memory.experiment-run-state.repository";
import type { ExperimentRunStateRepository } from "../repositories/experiment-run-state.repository";
import { createExperimentRunItemAppendStore } from "../stores/experiment-run-item.clickhouse.store";
import { createExperimentRunStateFoldStore } from "../stores/experiment-run-state.store";

export type ExperimentRunEventingStateRepository = ExperimentRunStateRepository;
export type ExperimentRunEventingIdLookup = ExperimentIdLookup;
export type ExperimentRunEventingResultRecord = ClickHouseExperimentRunResultRecord;
export type ExperimentRunEventingState = ExperimentRunStateData;

export class ExperimentEventingAdapter {
  static createStateRepository(input: {
    resolveClient: ExperimentEventingClickHouseResolver;
    clickhouseEnabled: boolean;
    defaultRetentionDays: number;
  }): ExperimentRunStateRepository {
    return input.clickhouseEnabled
      ? new ExperimentRunStateRepositoryClickHouse(
          ExperimentClickHouseAdapter.create(input.resolveClient),
          input.defaultRetentionDays,
        )
      : new ExperimentRunStateRepositoryMemory();
  }

  static createIdLookup(input: {
    resolveClient: ExperimentEventingClickHouseResolver;
    clickhouseEnabled: boolean;
  }): ExperimentIdLookup {
    return input.clickhouseEnabled
      ? new ExperimentIdLookupClickHouseRepository(
          ExperimentClickHouseAdapter.create(input.resolveClient),
        )
      : new NullExperimentIdLookupRepository();
  }

  static createItemStore(
    resolveClient: ExperimentEventingClickHouseResolver,
    defaultRetentionDays: number,
  ): AppendStore<ClickHouseExperimentRunResultRecord> {
    return createExperimentRunItemAppendStore(
      ExperimentClickHouseAdapter.create(resolveClient),
      defaultRetentionDays,
    );
  }

  static createStateFoldStore(
    repository: ExperimentRunStateRepository,
  ): FoldProjectionStore<ExperimentRunStateData> {
    return createExperimentRunStateFoldStore(repository);
  }
}

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
export function createExperimentRunProcessingPipeline(deps: ExperimentRunProcessingPipelineDeps) {
  const builder = definePipeline<ExperimentRunProcessingEvent>({
    name: "experiment_run_processing",
    aggregate: defineAggregate({
      type: "experiment_run",
      events: defineEvents(EXPERIMENT_RUN_PROCESSING_EVENT_TYPES),
    }),
  })
    .withClickHouseFoldProjection(
      new ExperimentRunStateFoldProjection({
        store: deps.experimentRunStateFoldStore,
      }),
    )
    .withClickHouseMapProjection(
      new ExperimentRunResultStorageMapProjection({
        store: deps.experimentRunItemAppendStore,
      }),
    );

  return builder
    .withCommand("startExperimentRun", StartExperimentRunCommand)
    .withCommand("recordTargetResult", RecordTargetResultCommand)
    .withCommand("recordEvaluatorResult", RecordEvaluatorResultCommand)
    .withCommand("computeExperimentRunMetrics", ComputeExperimentRunMetricsCommand)
    .withCommand("completeExperimentRun", CompleteExperimentRunCommand)
    .build();
}

/**
 * The definition this feature registers, named so a composition root can hold
 * one without restating its shape.
 */
export type ExperimentRunProcessingPipeline = ReturnType<
  typeof createExperimentRunProcessingPipeline
>;
