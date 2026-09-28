/**
 * Experiment's run pipeline, ported from the deleted `ExperimentWorkerFeatureInstaller`:
 * the app builds the definition, and the senders are bound back to it once registered.
 */
import {
  type AppendStore,
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type FoldProjectionStore,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { ExperimentApp } from "../app/experiment.app.ts";
import type {
  ExperimentRunPlanFoldState,
  ExperimentRunProgressState,
} from "../repositories/experiment-run-fold.repository.ts";
import {
  ExecuteExperimentCellCommand,
  type ExecuteExperimentCellCommandData,
  executeExperimentCellJobId,
} from "./experiment-run-cell.commands.ts";
import {
  type AbortRequestedEventData,
  type CellFinishedEventData,
  type EvaluatorResultEventData,
  type ExperimentRunCompletedEventData,
  type ExperimentRunProcessingEvent,
  type ExperimentRunStartedEventData,
  type TargetResultEventData,
  type TraceMetricsComputedEventData,
  type WorkflowEvaluationRequestedEventData,
  abortRequestedEventSchema,
  cellFinishedEventSchema,
  evaluatorResultEventSchema,
  experimentRunCompletedEventSchema,
  experimentRunStartedEventSchema,
  targetResultEventSchema,
  traceMetricsComputedEventSchema,
  workflowEvaluationRequestedEventSchema,
} from "./experiment-run-events.process.ts";
import {
  type ExperimentRunExecutionEffects,
  experimentRunExecutionProcess,
} from "./experiment-run-execution.process.ts";
import { EXPERIMENT_RUN_EXECUTION_PROCESS_NAME } from "./experiment-run-execution.schemas.ts";
import type { ExperimentRunProgressSubscriber } from "./experiment-run-frames.subscriber.ts";
import { ExperimentRunPlanFoldProjection } from "./experiment-run-plan.projection.ts";
import {
  AbortExperimentRunCommand,
  CompleteExperimentRunCommand,
  ComputeExperimentRunMetricsCommand,
  FailExperimentCellCommand,
  RecordEvaluatorResultCommand,
  RecordTargetResultCommand,
  RequestWorkflowEvaluationCommand,
  StartExperimentRunCommand,
} from "./experiment-run-processing.commands.ts";
import { ExperimentRunProgressFoldProjection } from "./experiment-run-progress.projection.ts";
import {
  type ClickHouseExperimentRunResultRecord,
  ExperimentRunResultStorageMapProjection,
} from "./experiment-run-result-storage.projection.ts";
import {
  type ExperimentRunStateData,
  ExperimentRunStateFoldProjection,
} from "./experiment-run-state.projection.ts";
import {
  createWorkflowEvaluationRequestedSubscriber,
  type WorkflowEvaluationRunner,
} from "./experiment-workflow-evaluation.subscriber.ts";

export const experimentRunProcessingEventing = defineEventingModule({
  pipeline: "experiment_run_processing",
  build: ({ app }: EventingSetup<never, ExperimentApp>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});

export interface ClickhouseExperimentRunProcessingRepository {
  experimentRunStateFoldStore: FoldProjectionStore<ExperimentRunStateData>;
  experimentRunItemAppendStore: AppendStore<ClickHouseExperimentRunResultRecord>;
  /** Runs a requested workflow evaluation; hosted only where the pipeline is drained. */
  workflowEvaluations: WorkflowEvaluationRunner;
  /** The run's plan, written once, and the progress its cells read (spec section 7). */
  experimentRunPlanFoldStore: FoldProjectionStore<ExperimentRunPlanFoldState>;
  experimentRunProgressFoldStore: FoldProjectionStore<ExperimentRunProgressState>;
  /** Runs one cell where the pipeline is drained. */
  executeCell: ExecuteExperimentCellCommand;
  /** What the run's execution manager's intents send. */
  runExecution: ExperimentRunExecutionEffects;
  /** The progress fold's reaction: each event's frames, live on the run's channel. */
  runFrames: ExperimentRunProgressSubscriber;
}

export type ExperimentRunProcessingPipeline = StaticPipelineDefinition<
  ExperimentRunProcessingEvent,
  Record<string, Projection>,
  | { name: "startExperimentRun"; payload: ExperimentRunStartedEventData }
  | { name: "recordTargetResult"; payload: TargetResultEventData }
  | { name: "recordEvaluatorResult"; payload: EvaluatorResultEventData }
  | { name: "computeExperimentRunMetrics"; payload: TraceMetricsComputedEventData }
  | { name: "completeExperimentRun"; payload: ExperimentRunCompletedEventData }
  | { name: "requestWorkflowEvaluation"; payload: WorkflowEvaluationRequestedEventData }
  | { name: "failExperimentCell"; payload: CellFinishedEventData }
  | { name: "abortExperimentRun"; payload: AbortRequestedEventData }
  | { name: "executeExperimentCell"; payload: ExecuteExperimentCellCommandData }
>;

/** The run pipeline over the stores a deployment composed for it. */
export function buildExperimentRunProcessingPipeline(
  deps: ClickhouseExperimentRunProcessingRepository,
): ExperimentRunProcessingPipeline {
  const builder = definePipeline({
    name: "experiment_run_processing",
    aggregate: defineAggregate({
      type: "experiment_run",
    }),
  })
    .withEvents([
      experimentRunStartedEventSchema,
      targetResultEventSchema,
      evaluatorResultEventSchema,
      traceMetricsComputedEventSchema,
      experimentRunCompletedEventSchema,
      workflowEvaluationRequestedEventSchema,
      cellFinishedEventSchema,
      abortRequestedEventSchema,
    ])
    .withClickHouseFoldProjection(
      ExperimentRunStateFoldProjection.create({
        store: deps.experimentRunStateFoldStore,
      }),
    )
    .withClickHouseFoldProjection(
      ExperimentRunPlanFoldProjection.create({ store: deps.experimentRunPlanFoldStore }),
    )
    .withClickHouseFoldProjection(
      ExperimentRunProgressFoldProjection.create({ store: deps.experimentRunProgressFoldStore }),
    )
    .withClickHouseMapProjection(
      ExperimentRunResultStorageMapProjection.create({
        store: deps.experimentRunItemAppendStore,
      }),
    )
    .withEventSubscriber(
      "workflowEvaluationRequested",
      createWorkflowEvaluationRequestedSubscriber(deps.workflowEvaluations),
    )
    .withProcessManager(
      EXPERIMENT_RUN_EXECUTION_PROCESS_NAME,
      experimentRunExecutionProcess(deps.runExecution),
    )
    .withProjectionSubscriber(deps.runFrames.name, deps.runFrames.spec);

  return builder
    .withCommand("startExperimentRun", StartExperimentRunCommand)
    .withCommand("recordTargetResult", RecordTargetResultCommand)
    .withCommand("recordEvaluatorResult", RecordEvaluatorResultCommand)
    .withCommand("computeExperimentRunMetrics", ComputeExperimentRunMetricsCommand)
    .withCommand("completeExperimentRun", CompleteExperimentRunCommand)
    .withCommand("requestWorkflowEvaluation", RequestWorkflowEvaluationCommand)
    .withCommand("failExperimentCell", FailExperimentCellCommand)
    .withCommand("abortExperimentRun", AbortExperimentRunCommand)
    .withCommandInstance({
      name: "executeExperimentCell",
      handlerClass: ExecuteExperimentCellCommand,
      instance: deps.executeCell,
      options: { deduplication: { makeId: executeExperimentCellJobId, ttlMs: 60_000 } },
    })
    .build();
}
