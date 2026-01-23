import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_SCHEDULED_EVENT_TYPE,
  EVALUATION_STARTED_EVENT_TYPE,
} from "./constants";
import type {
  EvaluationCompletedEvent,
  EvaluationProcessingEvent,
  EvaluationScheduledEvent,
  EvaluationStartedEvent,
} from "./events";

/**
 * Type guard for EvaluationScheduledEvent.
 */
export function isEvaluationScheduledEvent(
  event: EvaluationProcessingEvent,
): event is EvaluationScheduledEvent {
  return event.type === EVALUATION_SCHEDULED_EVENT_TYPE;
}

/**
 * Type guard for EvaluationStartedEvent.
 */
export function isEvaluationStartedEvent(
  event: EvaluationProcessingEvent,
): event is EvaluationStartedEvent {
  return event.type === EVALUATION_STARTED_EVENT_TYPE;
}

/**
 * Type guard for EvaluationCompletedEvent.
 */
export function isEvaluationCompletedEvent(
  event: EvaluationProcessingEvent,
): event is EvaluationCompletedEvent {
  return event.type === EVALUATION_COMPLETED_EVENT_TYPE;
}
