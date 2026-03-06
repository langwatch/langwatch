import { SUITE_RUN_EVENT_TYPES } from "./constants";
import type {
  SuiteRunCompletedEvent,
  SuiteRunProcessingEvent,
  SuiteRunScenarioStartedEvent,
  SuiteRunScenarioResultEvent,
  SuiteRunStartedEvent,
} from "./events";

export function isSuiteRunStartedEvent(
  event: SuiteRunProcessingEvent,
): event is SuiteRunStartedEvent {
  return event.type === SUITE_RUN_EVENT_TYPES.STARTED;
}

export function isSuiteRunScenarioStartedEvent(
  event: SuiteRunProcessingEvent,
): event is SuiteRunScenarioStartedEvent {
  return event.type === SUITE_RUN_EVENT_TYPES.SCENARIO_STARTED;
}

export function isSuiteRunScenarioResultEvent(
  event: SuiteRunProcessingEvent,
): event is SuiteRunScenarioResultEvent {
  return event.type === SUITE_RUN_EVENT_TYPES.SCENARIO_RESULT;
}

export function isSuiteRunCompletedEvent(
  event: SuiteRunProcessingEvent,
): event is SuiteRunCompletedEvent {
  return event.type === SUITE_RUN_EVENT_TYPES.COMPLETED;
}
