import { definePipeline } from "../../library";
import { FinishRunCommand } from "./commands/finishRun.command";
import { MessageSnapshotCommand } from "./commands/messageSnapshot.command";
import { StartRunCommand } from "./commands/startRun.command";
import { simulationRunStateFoldProjection } from "./projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "./schemas/events";

/**
 * Simulation processing pipeline definition (static, no runtime dependencies).
 *
 * This pipeline uses simulation_run aggregates (aggregateId = scenarioRunId).
 * It tracks the lifecycle of individual simulation runs (started → message snapshots → finished).
 *
 * Commands:
 * - startRun: Emits SimulationRunStartedEvent when a simulation run begins
 * - messageSnapshot: Emits SimulationMessageSnapshotEvent with conversation state
 * - finishRun: Emits SimulationRunFinishedEvent when a simulation run completes
 */
export const simulationProcessingPipelineDefinition =
  definePipeline<SimulationProcessingEvent>()
    .withName("simulation_processing")
    .withAggregateType("simulation_run")
    .withFoldProjection("simulationRunState", simulationRunStateFoldProjection)
    .withCommand("startRun", StartRunCommand)
    .withCommand("messageSnapshot", MessageSnapshotCommand)
    .withCommand("finishRun", FinishRunCommand)
    .build();
