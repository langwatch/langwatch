import { EXPERIMENT_RUN_EVENT_TYPES } from "./constants";
import type {
  ExperimentRunCompletedEvent,
  ExperimentRunProcessingEvent,
  ExperimentRunStartedEvent,
  EvaluatorResultEvent,
  TargetResultEvent,
  TraceMetricsComputedEvent,
} from "./events";

export function isExperimentRunStartedEvent(
  event: ExperimentRunProcessingEvent,
): event is ExperimentRunStartedEvent {
  return event.type === EXPERIMENT_RUN_EVENT_TYPES.STARTED;
}

export function isTargetResultEvent(
  event: ExperimentRunProcessingEvent,
): event is TargetResultEvent {
  return event.type === EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT;
}

export function isEvaluatorResultEvent(
  event: ExperimentRunProcessingEvent,
): event is EvaluatorResultEvent {
  return event.type === EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT;
}

export function isTraceMetricsComputedEvent(
  event: ExperimentRunProcessingEvent,
): event is TraceMetricsComputedEvent {
  return event.type === EXPERIMENT_RUN_EVENT_TYPES.TRACE_METRICS_COMPUTED;
}

export function isExperimentRunCompletedEvent(
  event: ExperimentRunProcessingEvent,
): event is ExperimentRunCompletedEvent {
  return event.type === EXPERIMENT_RUN_EVENT_TYPES.COMPLETED;
}
