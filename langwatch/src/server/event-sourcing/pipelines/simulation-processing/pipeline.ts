import { definePipeline } from "../../";
import type { SubscriberSpec } from "../../pipeline/processManagerDefinition";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import {
  CancelRunCommand,
  DeleteRunCommand,
  FinishRunCommand,
  MessageSnapshotCommand,
  QueueRunCommand,
  StartRunCommand,
  TextMessageEndCommand,
  TextMessageStartCommand,
} from "./commands";
import { ComputeRunMetricsCommand } from "./commands/computeRunMetrics.command";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "./projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "./schemas/events";

/** A named best-effort subscriber attachment (ADR-052). */
export interface SimulationSubscriber {
  name: string;
  spec: SubscriberSpec<SimulationProcessingEvent>;
}

export interface SimulationProcessingPipelineDeps {
  simulationRunStore: FoldProjectionStore<SimulationRunStateData>;
  snapshotUpdateBroadcastSubscriber: SimulationSubscriber;
  cancellationBroadcastSubscriber: SimulationSubscriber;
  scenarioExecutionReactor: ReactorDefinition<
    SimulationProcessingEvent,
    SimulationRunStateData
  >;
  suiteRunSyncSubscriber: SimulationSubscriber;
  traceMetricsSyncSubscriber: SimulationSubscriber;
  computeRunMetricsCommand: ComputeRunMetricsCommand;
  customerIoSimulationSyncSubscriber?: SimulationSubscriber;
}

/**
 * Creates the simulation processing pipeline definition.
 *
 * This pipeline uses simulation_run aggregates (aggregateId = scenarioRunId).
 * It tracks the lifecycle of simulation runs:
 * - started -> message snapshots -> finished (or deleted)
 *
 * Fold Projection: simulationRunState
 * - Tracks simulation run state (status, messages, verdict, etc.)
 * - Stored in simulation_runs ClickHouse table
 *
 * Commands:
 * - startRun: Emits SimulationRunStartedEvent when run begins
 * - messageSnapshot: Emits SimulationMessageSnapshotEvent for message updates
 * - finishRun: Emits SimulationRunFinishedEvent when run completes
 * - deleteRun: Emits SimulationRunDeletedEvent for soft-delete
 * - computeRunMetrics: Computes cost/latency metrics from traces (ECST + pull)
 */
export function createSimulationProcessingPipeline(
  deps: SimulationProcessingPipelineDeps,
) {
  let builder = definePipeline<SimulationProcessingEvent>()
    .withName("simulation_processing")
    .withAggregateType("simulation_run")
    .withFoldProjection(
      "simulationRunState",
      new SimulationRunStateFoldProjection({
        store: deps.simulationRunStore,
      }),
    )
    .withSubscriber(
      deps.snapshotUpdateBroadcastSubscriber.name,
      deps.snapshotUpdateBroadcastSubscriber.spec,
    )
    .withSubscriber(
      deps.cancellationBroadcastSubscriber.name,
      deps.cancellationBroadcastSubscriber.spec,
    )
    .withSubscriber(
      deps.suiteRunSyncSubscriber.name,
      deps.suiteRunSyncSubscriber.spec,
    )
    .withSubscriber(
      deps.traceMetricsSyncSubscriber.name,
      deps.traceMetricsSyncSubscriber.spec,
    )
    .withReactor(
      "simulationRunState",
      "scenarioExecution",
      deps.scenarioExecutionReactor,
    );

  if (deps.customerIoSimulationSyncSubscriber) {
    builder = builder.withSubscriber(
      deps.customerIoSimulationSyncSubscriber.name,
      deps.customerIoSimulationSyncSubscriber.spec,
    );
  }

  return builder
    .withCommand("queueRun", QueueRunCommand)
    .withCommand("startRun", StartRunCommand)
    .withCommand("messageSnapshot", MessageSnapshotCommand)
    .withCommand("textMessageStart", TextMessageStartCommand)
    .withCommand("textMessageEnd", TextMessageEndCommand)
    .withCommand("finishRun", FinishRunCommand)
    .withCommand("cancelRun", CancelRunCommand)
    .withCommand("deleteRun", DeleteRunCommand)
    .withCommandInstance(
      "computeRunMetrics",
      ComputeRunMetricsCommand,
      deps.computeRunMetricsCommand,
      {
        deduplication: {
          makeId: ComputeRunMetricsCommand.makeJobId,
          ttlMs: 60_000,
        },
      },
    )
    .build();
}
