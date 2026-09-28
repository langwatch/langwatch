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
  AbortExperimentRunCommand,
  CompleteExperimentRunCommand,
  ComputeExperimentRunMetricsCommand,
  FailExperimentCellCommand,
  RecordEvaluatorResultCommand,
  RecordTargetResultCommand,
  RequestWorkflowEvaluationCommand,
  StartExperimentRunCommand,
} from "./experiment-run-processing.commands.ts";
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
    .withClickHouseMapProjection(
      ExperimentRunResultStorageMapProjection.create({
        store: deps.experimentRunItemAppendStore,
      }),
    )
    .withEventSubscriber(
      "workflowEvaluationRequested",
      createWorkflowEvaluationRequestedSubscriber(deps.workflowEvaluations),
    );

  return builder
    .withCommand("startExperimentRun", StartExperimentRunCommand)
    .withCommand("recordTargetResult", RecordTargetResultCommand)
    .withCommand("recordEvaluatorResult", RecordEvaluatorResultCommand)
    .withCommand("computeExperimentRunMetrics", ComputeExperimentRunMetricsCommand)
    .withCommand("completeExperimentRun", CompleteExperimentRunCommand)
    .withCommand("requestWorkflowEvaluation", RequestWorkflowEvaluationCommand)
    .withCommand("failExperimentCell", FailExperimentCellCommand)
    .withCommand("abortExperimentRun", AbortExperimentRunCommand)
    .build();
}
