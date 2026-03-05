import { SIMULATION_RUN_EVENT_TYPES } from "./constants";
import type {
    SimulationMessageSnapshotEvent,
    SimulationProcessingEvent,
    SimulationRunDeletedEvent,
    SimulationRunFinishedEvent,
    SimulationRunStartedEvent,
} from "./events";

export function isSimulationRunStartedEvent(
  event: SimulationProcessingEvent,
): event is SimulationRunStartedEvent {
  return event.type === SIMULATION_RUN_EVENT_TYPES.STARTED;
}

export function isSimulationMessageSnapshotEvent(
  event: SimulationProcessingEvent,
): event is SimulationMessageSnapshotEvent {
  return event.type === SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT;
}

export function isSimulationRunFinishedEvent(
  event: SimulationProcessingEvent,
): event is SimulationRunFinishedEvent {
  return event.type === SIMULATION_RUN_EVENT_TYPES.FINISHED;
}

export function isSimulationRunDeletedEvent(
  event: SimulationProcessingEvent,
): event is SimulationRunDeletedEvent {
  return event.type === SIMULATION_RUN_EVENT_TYPES.DELETED;
}
