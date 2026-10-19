/**
 * The frames main's SSE sent, read back from the run's recorded events and its progress fold,
 * which supplies what an event alone does not: the counts a `progress` or `done` frame reports,
 * and whether an evaluator's name was ever streamed. Design: experiment-run-execution.md §7.
 */
import {
  type EvaluationV3Event,
  type EvaluationV3EvaluatorResult,
  type ExecutionSummary,
  UNNAMED_FAILURE,
} from "@langwatch/experiment-contract";

import type {
  EvaluatorResultEvent,
  EvaluatorResultEventData,
  ExperimentRunCompletedEvent,
  ExperimentRunProcessingEvent,
  TargetResultEvent,
} from "../eventing/experiment-run-events.process.ts";
import type { ExperimentRunRecentEvent } from "../repositories/experiment-run-fold.repository.ts";
import { EXPERIMENT_RUN_EVENT_TYPES } from "./experiment-run-event-types.rules.ts";

/** What a frame needs of the run beyond its own event, as the fold holds it after the event. */
export type RunFrameContext = {
  /** Cells finished, failed ones included, and the run's cell count. */
  progress: number;
  total: number;
  /** False for a redelivered finish: main streamed each cell's progress once. */
  cellNewlyFinished: boolean;
  summary?: ExecutionSummary;
  /** Main streamed an evaluator's name only when it had no database record. */
  evaluators: Record<string, { recordNamed: boolean }>;
};

/** The frames one recorded run event streams, in order; none for an event main never streamed. */
export function findRunEventFrames({
  event,
  run,
}: {
  event: ExperimentRunProcessingEvent;
  run: RunFrameContext;
}): EvaluationV3Event[] {
  switch (event.type) {
    case EXPERIMENT_RUN_EVENT_TYPES.STARTED:
      return [{ type: "execution_started", runId: event.data.runId, total: event.data.total }];
    case EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT:
      // A board cell carried into the run was copied, never run, and main never streamed it.
      return event.data.carriedOver ? [] : [targetResultFrame({ event })];
    case EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT:
      return event.data.carriedOver ? [] : [evaluatorResultFrame({ event, run })];
    case EXPERIMENT_RUN_EVENT_TYPES.CELL_FINISHED:
      if (!run.cellNewlyFinished) return [];
      return [{ type: "progress", completed: run.progress, total: run.total }];
    case EXPERIMENT_RUN_EVENT_TYPES.COMPLETED:
      return completionFrames({ event, run });
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

/** Main's `evaluator_result` frame, its result rebuilt from the fields the event keeps. */
function evaluatorResultFrame({
  event,
  run,
}: {
  event: EvaluatorResultEvent;
  run: RunFrameContext;
}): EvaluationV3Event {
  const { data } = event;
  const streamedName = run.evaluators[data.evaluatorId]?.recordNamed ? null : data.evaluatorName;
  return {
    type: "evaluator_result",
    rowIndex: data.index,
    targetId: data.targetId,
    evaluatorId: data.evaluatorId,
    ...(streamedName != null ? { evaluatorName: streamedName } : {}),
    result: evaluatorResultOf(data),
    ...(data.duration != null ? { duration: data.duration } : {}),
    ...(data.inputs != null ? { inputs: data.inputs } : {}),
  };
}

function evaluatorResultOf(data: EvaluatorResultEventData): EvaluationV3EvaluatorResult {
  const domainError = data.domainError != null ? { domainError: data.domainError } : {};
  if (data.status === "error") {
    return {
      status: "error",
      error_type: data.errorType ?? "EvaluatorError",
      details: data.details ?? "",
      traceback: data.traceback ?? [],
      ...domainError,
    };
  }

  const shared = {
    ...(data.details != null ? { details: data.details } : {}),
    ...(data.cost != null && data.costCurrency != null
      ? { cost: { currency: data.costCurrency, amount: data.cost } }
      : {}),
    ...domainError,
  };
  if (data.status === "skipped") return { status: "skipped", ...shared };

  return {
    status: "processed",
    ...(data.score != null ? { score: data.score } : {}),
    ...(data.passed != null ? { passed: data.passed } : {}),
    ...(data.label != null ? { label: data.label } : {}),
    ...(data.rawResponse !== undefined ? { raw_response: data.rawResponse } : {}),
    ...shared,
  };
}

/** A run ends done with its summary, stopped, or with main's run-level error frame. */
function completionFrames({
  event,
  run,
}: {
  event: ExperimentRunCompletedEvent;
  run: RunFrameContext;
}): EvaluationV3Event[] {
  const { outcome, error } = event.data;
  if (outcome === "stopped") return [{ type: "stopped", reason: "user" }];
  if (outcome !== "failed") return run.summary ? [{ type: "done", summary: run.summary }] : [];
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

/** Main kept a run's last 50 frames for a poller to read. */
const RECENT_EVENTS_KEPT = 50;

/** The run's frame numbering and recent frames once `frames` from event `eventId` are streamed. */
export function appendRunFrames({
  run,
  eventId,
  frames,
}: {
  run: { seq: number; recentEvents: ExperimentRunRecentEvent[] };
  eventId: string;
  frames: EvaluationV3Event[];
}): { seq: number; recentEvents: ExperimentRunRecentEvent[] } {
  if (frames.length === 0) return { seq: run.seq, recentEvents: run.recentEvents };

  const numbered = frames.map((frame, index) => ({ seq: run.seq + index + 1, eventId, frame }));
  return {
    seq: run.seq + frames.length,
    recentEvents: [...run.recentEvents, ...numbered].slice(-RECENT_EVENTS_KEPT),
  };
}

/** The frames one event streamed, in order, as the fold numbered them. */
export function framesOfEvent({
  run,
  eventId,
}: {
  run: { recentEvents: ExperimentRunRecentEvent[] };
  eventId: string;
}): ExperimentRunRecentEvent[] {
  return run.recentEvents.filter((recent) => recent.eventId === eventId);
}
