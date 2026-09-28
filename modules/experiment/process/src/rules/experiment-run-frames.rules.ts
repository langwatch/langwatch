/**
 * The frames main's SSE sent, read back from the run's recorded events. Only frames an event
 * determines alone are here: `progress` and `done` need the run's counts, `evaluator_result`
 * needs fields its event does not keep. Design: specs/experiment-run-execution.md section 7.
 */
import { type EvaluationV3Event, UNNAMED_FAILURE } from "@langwatch/experiment-contract";

import type {
  ExperimentRunCompletedEvent,
  ExperimentRunProcessingEvent,
  TargetResultEvent,
} from "../eventing/experiment-run-events.process.ts";
import { EXPERIMENT_RUN_EVENT_TYPES } from "./experiment-run-event-types.rules.ts";

/** The frames one recorded run event streams, in order; none for an event main never streamed. */
export function findRunEventFrames({
  event,
}: {
  event: ExperimentRunProcessingEvent;
}): EvaluationV3Event[] {
  switch (event.type) {
    case EXPERIMENT_RUN_EVENT_TYPES.STARTED:
      return [{ type: "execution_started", runId: event.data.runId, total: event.data.total }];
    case EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT:
      // A board cell carried into the run was copied, never run, and main never streamed it.
      return event.data.carriedOver ? [] : [targetResultFrame({ event })];
    case EXPERIMENT_RUN_EVENT_TYPES.COMPLETED:
      return completionFrames({ event });
    default:
      return [];
  }
}

/** Main's `target_result` frame, from what the cell recorded. */
function targetResultFrame({ event }: { event: TargetResultEvent }): EvaluationV3Event {
  const { data } = event;
  return {
    type: "target_result",
    rowIndex: data.index,
    targetId: data.targetId,
    output: data.predicted?.output,
    ...(data.cost != null ? { cost: data.cost } : {}),
    ...(data.duration != null ? { duration: data.duration } : {}),
    ...(data.traceId != null ? { traceId: data.traceId } : {}),
    ...(data.error != null ? { error: data.error } : {}),
    ...(data.domainError != null ? { domainError: data.domainError } : {}),
  };
}

/** A stop ends the stream as main's did; a failed run sends main's run-level error frame. */
function completionFrames({ event }: { event: ExperimentRunCompletedEvent }): EvaluationV3Event[] {
  const { outcome, error } = event.data;
  if (outcome === "stopped") return [{ type: "stopped", reason: "user" }];
  if (outcome !== "failed") return [];
  if (!error) return [{ type: "error", message: UNNAMED_FAILURE }];
  return [
    {
      type: "error",
      message: error.code,
      domainError: error,
      ...(error.traceId !== undefined ? { traceId: error.traceId } : {}),
    },
  ];
}
