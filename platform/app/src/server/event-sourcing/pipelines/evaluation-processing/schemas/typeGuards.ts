import { EVALUATION_EVENT_TYPES } from "./constants";
import type {
  EvaluationCompletedEvent,
  EvaluationProcessingEvent,
  EvaluationReportedEvent,
  EvaluationScheduledEvent,
  EvaluationStartedEvent,
} from "./events";

/**
 * Type guard for EvaluationScheduledEvent.
 */
export function isEvaluationScheduledEvent(
  event: EvaluationProcessingEvent,
): event is EvaluationScheduledEvent {
  return event.type === EVALUATION_EVENT_TYPES.SCHEDULED;
}

/**
 * Type guard for EvaluationStartedEvent.
 */
export function isEvaluationStartedEvent(
  event: EvaluationProcessingEvent,
): event is EvaluationStartedEvent {
  return event.type === EVALUATION_EVENT_TYPES.STARTED;
}

/**
 * Type guard for EvaluationCompletedEvent.
 */
export function isEvaluationCompletedEvent(
  event: EvaluationProcessingEvent,
): event is EvaluationCompletedEvent {
  return event.type === EVALUATION_EVENT_TYPES.COMPLETED;
}

/**
 * Type guard for EvaluationReportedEvent.
 */
export function isEvaluationReportedEvent(
  event: EvaluationProcessingEvent,
): event is EvaluationReportedEvent {
  return event.type === EVALUATION_EVENT_TYPES.REPORTED;
}
