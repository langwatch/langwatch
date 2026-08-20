import { SUITE_RUN_EVENT_TYPES } from "./constants";
import type {
  SuiteRunItemCompletedEvent,
  SuiteRunItemStartedEvent,
  SuiteRunProcessingEvent,
  SuiteRunStartedEvent,
} from "./events";

export function isSuiteRunStartedEvent(
  event: SuiteRunProcessingEvent,
): event is SuiteRunStartedEvent {
  return event.type === SUITE_RUN_EVENT_TYPES.STARTED;
}

export function isSuiteRunItemStartedEvent(
  event: SuiteRunProcessingEvent,
): event is SuiteRunItemStartedEvent {
  return event.type === SUITE_RUN_EVENT_TYPES.ITEM_STARTED;
}

export function isSuiteRunItemCompletedEvent(
  event: SuiteRunProcessingEvent,
): event is SuiteRunItemCompletedEvent {
  return event.type === SUITE_RUN_EVENT_TYPES.ITEM_COMPLETED;
}
