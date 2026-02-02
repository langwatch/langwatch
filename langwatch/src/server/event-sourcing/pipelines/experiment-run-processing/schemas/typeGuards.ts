import {
  EXPERIMENT_RUN_COMPLETED_EVENT_TYPE,
  EXPERIMENT_RUN_STARTED_EVENT_TYPE,
  EVALUATOR_RESULT_EVENT_TYPE,
  TARGET_RESULT_EVENT_TYPE,
} from "./constants";
import type {
  ExperimentRunCompletedEvent,
  ExperimentRunProcessingEvent,
  ExperimentRunStartedEvent,
  EvaluatorResultEvent,
  TargetResultEvent,
} from "./events";

/**
 * Type guard for ExperimentRunStartedEvent.
 */
export function isExperimentRunStartedEvent(
  event: ExperimentRunProcessingEvent,
): event is ExperimentRunStartedEvent {
  return event.type === EXPERIMENT_RUN_STARTED_EVENT_TYPE;
}

/**
 * Type guard for TargetResultEvent.
 */
export function isTargetResultEvent(
  event: ExperimentRunProcessingEvent,
): event is TargetResultEvent {
  return event.type === TARGET_RESULT_EVENT_TYPE;
}

/**
 * Type guard for EvaluatorResultEvent.
 */
export function isEvaluatorResultEvent(
  event: ExperimentRunProcessingEvent,
): event is EvaluatorResultEvent {
  return event.type === EVALUATOR_RESULT_EVENT_TYPE;
}

/**
 * Type guard for ExperimentRunCompletedEvent.
 */
export function isExperimentRunCompletedEvent(
  event: ExperimentRunProcessingEvent,
): event is ExperimentRunCompletedEvent {
  return event.type === EXPERIMENT_RUN_COMPLETED_EVENT_TYPE;
}
