import {
  BATCH_EVALUATION_COMPLETED_EVENT_TYPE,
  BATCH_EVALUATION_STARTED_EVENT_TYPE,
  EVALUATOR_RESULT_RECEIVED_EVENT_TYPE,
  TARGET_RESULT_RECEIVED_EVENT_TYPE,
} from "./constants";
import type {
  BatchEvaluationCompletedEvent,
  BatchEvaluationProcessingEvent,
  BatchEvaluationStartedEvent,
  EvaluatorResultReceivedEvent,
  TargetResultReceivedEvent,
} from "./events";

/**
 * Type guard for BatchEvaluationStartedEvent.
 */
export function isBatchEvaluationStartedEvent(
  event: BatchEvaluationProcessingEvent,
): event is BatchEvaluationStartedEvent {
  return event.type === BATCH_EVALUATION_STARTED_EVENT_TYPE;
}

/**
 * Type guard for TargetResultReceivedEvent.
 */
export function isTargetResultReceivedEvent(
  event: BatchEvaluationProcessingEvent,
): event is TargetResultReceivedEvent {
  return event.type === TARGET_RESULT_RECEIVED_EVENT_TYPE;
}

/**
 * Type guard for EvaluatorResultReceivedEvent.
 */
export function isEvaluatorResultReceivedEvent(
  event: BatchEvaluationProcessingEvent,
): event is EvaluatorResultReceivedEvent {
  return event.type === EVALUATOR_RESULT_RECEIVED_EVENT_TYPE;
}

/**
 * Type guard for BatchEvaluationCompletedEvent.
 */
export function isBatchEvaluationCompletedEvent(
  event: BatchEvaluationProcessingEvent,
): event is BatchEvaluationCompletedEvent {
  return event.type === BATCH_EVALUATION_COMPLETED_EVENT_TYPE;
}
