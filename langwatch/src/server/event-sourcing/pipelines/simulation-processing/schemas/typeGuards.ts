import { SIMULATION_RUN_EVENT_TYPES } from "./constants";
import type {
    SimulationMessageSnapshotEvent,
    SimulationProcessingEvent,
    SimulationRunDeletedEvent,
    SimulationRunFinishedEvent,
    SimulationRunQueuedEvent,
    SimulationRunStartedEvent,
    SimulationTextMessageEndEvent,
    SimulationTextMessageStartEvent,
} from "./events";

export function isSimulationRunQueuedEvent(
  event: SimulationProcessingEvent,
): event is SimulationRunQueuedEvent {
  return event.type === SIMULATION_RUN_EVENT_TYPES.QUEUED;
}

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

export function isSimulationTextMessageStartEvent(
  event: SimulationProcessingEvent,
): event is SimulationTextMessageStartEvent {
  return event.type === SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START;
}

export function isSimulationTextMessageEndEvent(
  event: SimulationProcessingEvent,
): event is SimulationTextMessageEndEvent {
  return event.type === SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END;
}

export function isSimulationRunDeletedEvent(
  event: SimulationProcessingEvent,
): event is SimulationRunDeletedEvent {
  return event.type === SIMULATION_RUN_EVENT_TYPES.DELETED;
}
