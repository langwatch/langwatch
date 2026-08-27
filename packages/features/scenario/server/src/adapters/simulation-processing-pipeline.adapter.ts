import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
  type ProcessManagerApplier,
} from "@langwatch/eventing";
import type { SimulationProcessingEvent, SimulationService } from "@langwatch/scenario-contract";
import { SimulationProcessingCommandsAdapter } from "./simulation-processing-commands.adapter";
import { FinishRunCommand } from "./finish-run.adapter";
import { ComputeRunMetricsCommand } from "./compute-run-metrics.adapter";
import type { SimulationRunMetricsStoreAdapter } from "./simulation-eventing.adapter";
import { SimulationRunMetricsMapProjection } from "../projections/simulation-run-metrics.projection";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "../projections/simulation-run-state.projection";
import { SIMULATION_PROCESSING_EVENT_TYPES } from "@langwatch/scenario-contract";
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
  simulationRunMetricsStore: SimulationRunMetricsStoreAdapter;
  finishRunCommand: FinishRunCommand;
  computeRunMetricsCommand: ComputeRunMetricsCommand;
  scenarioRunExecution: { name: string; process: ProcessManagerApplier<SimulationProcessingEvent> };
  simulations: SimulationService;
  snapshotUpdateBroadcast: SnapshotUpdateBroadcastSubscriberDeps;
  suiteRunSync: SuiteRunSyncSubscriberDeps;
  traceMetricsSync: TraceMetricsSyncSubscriberDeps;
}

export class SimulationProcessingPipelineAdapter {
  static create(deps: SimulationProcessingPipelineDeps) {
    const commands = SimulationProcessingCommandsAdapter.create();

    return definePipeline<SimulationProcessingEvent>({
      name: "simulation_processing",
      aggregate: defineAggregate({
        type: "simulation_run",
        events: defineEvents(SIMULATION_PROCESSING_EVENT_TYPES),
      }),
    })
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
      .withCommand("queueRun", commands.queueRun)
      .withCommand("startRun", commands.startRun)
      .withCommand("messageSnapshot", commands.messageSnapshot)
      .withCommand("textMessageStart", commands.textMessageStart)
      .withCommand("textMessageEnd", commands.textMessageEnd)
      .withCommandInstance("finishRun", FinishRunCommand, deps.finishRunCommand)
      .withCommand("cancelRun", commands.cancelRun)
      .withCommand("deleteRun", commands.deleteRun)
      .withCommandInstance(
        "computeRunMetrics",
        ComputeRunMetricsCommand,
        deps.computeRunMetricsCommand,
        {
          deduplication: { makeId: ComputeRunMetricsCommand.makeJobId, ttlMs: 60_000 },
        },
      )
      .build();
  }

  private constructor() {}
}
