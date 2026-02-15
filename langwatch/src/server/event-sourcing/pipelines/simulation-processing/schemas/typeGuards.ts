import { SIMULATION_EVENT_TYPES } from "./constants";
import type {
  SimulationMessageSnapshotEvent,
  SimulationProcessingEvent,
  SimulationRunFinishedEvent,
  SimulationRunStartedEvent,
} from "./events";

export function isSimulationRunStartedEvent(
  event: SimulationProcessingEvent,
): event is SimulationRunStartedEvent {
  return event.type === SIMULATION_EVENT_TYPES.RUN_STARTED;
}

export function isSimulationMessageSnapshotEvent(
  event: SimulationProcessingEvent,
): event is SimulationMessageSnapshotEvent {
  return event.type === SIMULATION_EVENT_TYPES.MESSAGE_SNAPSHOT;
}

export function isSimulationRunFinishedEvent(
  event: SimulationProcessingEvent,
): event is SimulationRunFinishedEvent {
  return event.type === SIMULATION_EVENT_TYPES.RUN_FINISHED;
}
