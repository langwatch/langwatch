import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
  EVALUATION_SCHEDULED_EVENT_TYPE,
  EVALUATION_STARTED_EVENT_TYPE,
} from "./constants";
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

/**
 * Type guard for EvaluationReportedEvent.
 */
export function isEvaluationReportedEvent(
  event: EvaluationProcessingEvent,
): event is EvaluationReportedEvent {
  return event.type === EVALUATION_REPORTED_EVENT_TYPE;
}
