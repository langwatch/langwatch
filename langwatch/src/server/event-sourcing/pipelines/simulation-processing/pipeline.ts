import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import { DeleteRunCommand } from "./commands/deleteRun.command";
import { FinishRunCommand } from "./commands/finishRun.command";
import { MessageSnapshotCommand } from "./commands/messageSnapshot.command";
import { StartRunCommand } from "./commands/startRun.command";
import { createSimulationRunStateFoldProjection, type SimulationRunStateData } from "./projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "./schemas/events";

export interface SimulationProcessingPipelineDeps {
  simulationRunStore: FoldProjectionStore<SimulationRunStateData>;
  snapshotUpdateBroadcastReactor: ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData>;
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
 */
export function createSimulationProcessingPipeline(deps: SimulationProcessingPipelineDeps) {
  return definePipeline<SimulationProcessingEvent>()
    .withName("simulation_processing")
    .withAggregateType("simulation_run")
    .withFoldProjection("simulationRunState", createSimulationRunStateFoldProjection({
      store: deps.simulationRunStore,
    }))
    .withReactor("simulationRunState", "snapshotUpdateBroadcast", deps.snapshotUpdateBroadcastReactor)
    .withCommand("startRun", StartRunCommand)
    .withCommand("messageSnapshot", MessageSnapshotCommand)
    .withCommand("finishRun", FinishRunCommand)
    .withCommand("deleteRun", DeleteRunCommand)
    .build();
}
