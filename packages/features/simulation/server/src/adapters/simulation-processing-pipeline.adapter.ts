import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
  type ProcessManagerApplier,
} from "@langwatch/eventing";
import type { SimulationProcessingEvent, SimulationService } from "@langwatch/simulation-contract";
import {
  CancelRunCommand,
  DeleteRunCommand,
  FinishRunCommand,
  MessageSnapshotCommand,
  QueueRunCommand,
  StartRunCommand,
  TextMessageEndCommand,
  TextMessageStartCommand,
} from "./simulation-processing-commands.adapter";
import { ComputeRunMetricsCommand } from "./compute-run-metrics.adapter";
import {
  SimulationRunMetricsMapProjection,
  type SimulationRunMetricsProjectionRecord,
} from "../projections/simulation-run-metrics.projection";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "../projections/simulation-run-state.projection";
import { SIMULATION_PROCESSING_EVENT_TYPES } from "./simulation-run.adapter";
import {
  createSnapshotUpdateBroadcastSubscriber,
  type SnapshotUpdateBroadcastSubscriberDeps,
} from "../subscribers/snapshot-update-broadcast.subscriber";
import {
  createSuiteRunSyncSubscriber,
  type SuiteRunSyncSubscriberDeps,
} from "../subscribers/suite-run-sync.subscriber";
import {
  createTraceMetricsSyncSubscriber,
  type TraceMetricsSyncSubscriberDeps,
} from "../subscribers/trace-metrics-sync.subscriber";

export interface SimulationProcessingPipelineDeps {
  simulationRunStore: FoldProjectionStore<SimulationRunStateData>;
  simulationRunMetricsStore: AppendStore<SimulationRunMetricsProjectionRecord>;
  finishRunCommand: FinishRunCommand;
  computeRunMetricsCommand: ComputeRunMetricsCommand;
  scenarioRunExecution: { name: string; process: ProcessManagerApplier<SimulationProcessingEvent> };
  simulations: SimulationService;
  snapshotUpdateBroadcast: SnapshotUpdateBroadcastSubscriberDeps;
  suiteRunSync: SuiteRunSyncSubscriberDeps;
  traceMetricsSync: TraceMetricsSyncSubscriberDeps;
}

export function createSimulationProcessingPipeline(deps: SimulationProcessingPipelineDeps) {
  return definePipeline<SimulationProcessingEvent>({
    name: "simulation_processing",
    aggregate: defineAggregate({
      type: "simulation_run",
      events: defineEvents(SIMULATION_PROCESSING_EVENT_TYPES),
    }),
  })
    .withClickHouseFoldProjection(new SimulationRunStateFoldProjection({ store: deps.simulationRunStore }))
    .withClickHouseMapProjection(
      new SimulationRunMetricsMapProjection({ store: deps.simulationRunMetricsStore }),
    )
    .withEventSubscriber(
      "snapshotUpdateBroadcast",
      createSnapshotUpdateBroadcastSubscriber(deps.snapshotUpdateBroadcast),
    )
    .withEventSubscriber("suiteRunSync", createSuiteRunSyncSubscriber(deps.suiteRunSync))
    .withEventSubscriber("traceMetricsSync", createTraceMetricsSyncSubscriber(deps.traceMetricsSync))
    .withProcessManager(deps.scenarioRunExecution.name, deps.scenarioRunExecution.process)
    .withCommand("queueRun", QueueRunCommand)
    .withCommand("startRun", StartRunCommand)
    .withCommand("messageSnapshot", MessageSnapshotCommand)
    .withCommand("textMessageStart", TextMessageStartCommand)
    .withCommand("textMessageEnd", TextMessageEndCommand)
    .withCommandInstance("finishRun", FinishRunCommand, deps.finishRunCommand)
    .withCommand("cancelRun", CancelRunCommand)
    .withCommand("deleteRun", DeleteRunCommand)
    .withCommandInstance("computeRunMetrics", ComputeRunMetricsCommand, deps.computeRunMetricsCommand, {
      deduplication: { makeId: ComputeRunMetricsCommand.makeJobId, ttlMs: 60_000 },
    })
    .build();
}
