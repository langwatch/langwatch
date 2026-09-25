import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type AppendStore,
  type EventingSetup,
  type FoldProjectionStore,
  type ProcessManagerApplier,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { SimulationProcessingEvent, SimulationService } from "@langwatch/scenario-contract";
import {
  SimulationRunQueuedEventSchema,
  SimulationRunStartedEventSchema,
  SimulationMessageSnapshotEventSchema,
  SimulationRunFinishedEventSchema,
  SimulationRunEvaluatedEventSchema,
  SimulationTextMessageStartEventSchema,
  SimulationTextMessageEndEventSchema,
  SimulationRunMetricsComputedEventSchema,
  SimulationRunCancelRequestedEventSchema,
  SimulationRunAgentInstanceRecordedEventSchema,
  SimulationRunCutAtLimitRecordedEventSchema,
  SimulationRunDeletedEventSchema,
  SimulationSetArchivedEventSchema,
} from "@langwatch/scenario-contract";

import type { ScenarioApp } from "../app/scenario.app.ts";
import { ComputeRunMetricsCommand } from "./compute-run-metrics.commands.ts";
import { FinishRunCommand } from "./finish-run.commands.ts";
import { QueueRunCommand } from "./queue-run.commands.ts";
import { RecordEvaluationsCommand } from "./record-evaluations.commands.ts";
import { SimulationProcessingCommandsAdapter } from "./simulation-processing.commands.ts";
import {
  SimulationRunMetricsMapProjection,
  type SimulationRunMetricsProjectionRecord,
} from "./simulation-run-metrics.projection.ts";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "./simulation-run-state.projection.ts";
import {
  createSnapshotUpdateBroadcastSubscriber,
  type SnapshotUpdateBroadcastSubscriberDeps,
} from "./snapshot-update-broadcast.subscriber.ts";
import {
  createSuiteRunSyncSubscriber,
  type SuiteRunSyncSubscriberDeps,
} from "./suite-run-sync.subscriber.ts";
import {
  createTraceMetricsSyncSubscriber,
  type TraceMetricsSyncSubscriberDeps,
} from "./trace-metrics-sync.subscriber.ts";

export interface SimulationProcessingPipelineDeps {
  simulationRunStore: FoldProjectionStore<SimulationRunStateData>;
  /**
   * The metrics map projection's own append seat, named as the PORT it is.
   * A process that only PRODUCES commands folds nothing and has no such
   * adapter to hand — naming the concrete class here blocked it registering at all.
   */
  simulationRunMetricsStore: AppendStore<SimulationRunMetricsProjectionRecord>;
  queueRunCommand: QueueRunCommand;
  finishRunCommand: FinishRunCommand;
  recordEvaluationsCommand: RecordEvaluationsCommand;
  computeRunMetricsCommand: ComputeRunMetricsCommand;
  scenarioRunExecution: { name: string; process: ProcessManagerApplier<SimulationProcessingEvent> };
  scenarioEvaluations: { name: string; process: ProcessManagerApplier<SimulationProcessingEvent> };
  simulations: SimulationService;
  snapshotUpdateBroadcast: SnapshotUpdateBroadcastSubscriberDeps;
  suiteRunSync: SuiteRunSyncSubscriberDeps;
  traceMetricsSync: TraceMetricsSyncSubscriberDeps;
}

function buildSimulationProcessingPipelineDefinition(
  deps: SimulationProcessingPipelineDeps,
): SimulationProcessingPipelineDefinition {
  const commands = SimulationProcessingCommandsAdapter.create();

  return definePipeline({
    name: "simulation_processing",
    aggregate: defineAggregate({
      type: "simulation_run",
    }),
  })
    .withEvents([
      SimulationRunQueuedEventSchema,
      SimulationRunStartedEventSchema,
      SimulationMessageSnapshotEventSchema,
      SimulationRunFinishedEventSchema,
      SimulationRunEvaluatedEventSchema,
      SimulationTextMessageStartEventSchema,
      SimulationTextMessageEndEventSchema,
      SimulationRunMetricsComputedEventSchema,
      SimulationRunCancelRequestedEventSchema,
      SimulationRunAgentInstanceRecordedEventSchema,
      SimulationRunCutAtLimitRecordedEventSchema,
      SimulationRunDeletedEventSchema,
      SimulationSetArchivedEventSchema,
    ])
    .withClickHouseFoldProjection(
      SimulationRunStateFoldProjection.create({ store: deps.simulationRunStore }),
    )
    .withClickHouseMapProjection(
      SimulationRunMetricsMapProjection.create({ store: deps.simulationRunMetricsStore }),
    )
    .withEventSubscriber(
      "snapshotUpdateBroadcast",
      createSnapshotUpdateBroadcastSubscriber(deps.snapshotUpdateBroadcast),
    )
    .withEventSubscriber("suiteRunSync", createSuiteRunSyncSubscriber(deps.suiteRunSync))
    .withEventSubscriber(
      "traceMetricsSync",
      createTraceMetricsSyncSubscriber(deps.traceMetricsSync),
    )
    .withProcessManager(deps.scenarioRunExecution.name, deps.scenarioRunExecution.process)
    .withProcessManager(deps.scenarioEvaluations.name, deps.scenarioEvaluations.process)
    .withCommandInstance("queueRun", QueueRunCommand, deps.queueRunCommand)
    .withCommand("startRun", commands.startRun)
    .withCommand("messageSnapshot", commands.messageSnapshot)
    .withCommand("textMessageStart", commands.textMessageStart)
    .withCommand("textMessageEnd", commands.textMessageEnd)
    .withCommandInstance("finishRun", FinishRunCommand, deps.finishRunCommand)
    .withCommandInstance(
      "recordEvaluations",
      RecordEvaluationsCommand,
      deps.recordEvaluationsCommand,
    )
    .withCommand("cancelRun", commands.cancelRun)
    .withCommand("deleteRun", commands.deleteRun)
    .withCommand("recordAgentInstance", commands.recordAgentInstance)
    .withCommandInstance(
      "computeRunMetrics",
      ComputeRunMetricsCommand,
      deps.computeRunMetricsCommand,
      {
        deduplication: {
          makeId: (
            ...args: Parameters<typeof ComputeRunMetricsCommand.makeJobId>
          ): ReturnType<typeof ComputeRunMetricsCommand.makeJobId> =>
            ComputeRunMetricsCommand.makeJobId(...args),
          ttlMs: 60_000,
        },
      },
    )
    .build();
}

/** The pipeline `SimulationProcessingPipelineAdapter.create` answers; commands
 * left `any`, as `AuthzPipeline` and `AnyPipelineDefinition` do. */
export type SimulationProcessingPipelineDefinition = StaticPipelineDefinition<
  SimulationProcessingEvent,
  Record<string, Projection>,
  any
>;

export class SimulationProcessingPipelineAdapter {
  static create(deps: SimulationProcessingPipelineDeps): SimulationProcessingPipelineDefinition {
    return buildSimulationProcessingPipelineDefinition(deps);
  }

  private constructor() {}
}

/** simulation_processing, built by the app in both roles; its senders carry every run write. */
export const simulationProcessingEventing = defineEventingModule({
  pipeline: "simulation_processing",
  build: ({ app, participation, priorEvents, resources }: EventingSetup<never, ScenarioApp>) =>
    app.simulationPipeline({
      participation,
      ...(priorEvents ? { priorEvents } : {}),
      ...(resources ? { resources } : {}),
    }),
  connect: ({ app, commands }) => app.connectSimulationCommands(commands),
});
