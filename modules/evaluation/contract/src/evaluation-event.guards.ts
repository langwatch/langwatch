import {
  EVALUATION_ATTEMPT_FAILED_EVENT_TYPE,
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
  EVALUATION_SCHEDULED_EVENT_TYPE,
  EVALUATION_STARTED_EVENT_TYPE,
} from "./evaluation-event.constants.ts";
import type {
  EvaluationAttemptFailedEvent,
  EvaluationCompletedEvent,
  EvaluationProcessingEvent,
  EvaluationReportedEvent,
  EvaluationScheduledEvent,
  EvaluationStartedEvent,
} from "./evaluation.events.ts";

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

/**
 * Type guard for EvaluationAttemptFailedEvent.
 */
export function isEvaluationAttemptFailedEvent(
  event: EvaluationProcessingEvent,
): event is EvaluationAttemptFailedEvent {
  return event.type === EVALUATION_ATTEMPT_FAILED_EVENT_TYPE;
}
