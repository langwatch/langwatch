/**
 * The run's counters, folded from its own events onto the row a caller polls. It
 * folds counters only: the definition is written once, when the run is accepted.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import type { StateProjectionDefinition, StateProjectionStore } from "@langwatch/eventing";
import {
  INSTANT_EVAL_EVENT_TYPES,
  INSTANT_EVAL_PROCESSING_EVENT_TYPES,
  INSTANT_EVAL_PROJECTION_VERSIONS,
  type InstantEvalProcessingEvent,
} from "@langwatch/instant-eval-contract";

import type { InstantEvalStoredStatus } from "../rules/instant-eval-run-status.rules.ts";

/** Everything this projection maintains on a run's row. */
export interface InstantEvalRunProjectionState {
  readonly status: InstantEvalStoredStatus;
  /** Rows the key pass found, or null before it ran. */
  readonly total: number | null;
  readonly progress: number;
  /**
   * Matches across the run's boolean questions, or null when it has none.
   * Null rather than zero, because zero is a real answer ("no row matched")
   * and a run with no boolean question has no such answer to give.
   */
  readonly matched: number | null;
  readonly matchedByQuestion: Readonly<Record<string, number>>;
  readonly failed: number;
  readonly skipped: number;
  readonly tokens: number;
  readonly costUsd: number;
  readonly priceUsd: number;
  readonly error: string | null;
  /** Epoch milliseconds, or null while the run has not reached that point. */
  readonly startedAtMs: number | null;
  readonly finishedAtMs: number | null;
}

export const INITIAL_INSTANT_EVAL_RUN_STATE: InstantEvalRunProjectionState = {
  status: "QUEUED",
  total: null,
  progress: 0,
  matched: null,
  matchedByQuestion: {},
  failed: 0,
  skipped: 0,
  tokens: 0,
  costUsd: 0,
  priceUsd: 0,
  error: null,
  startedAtMs: null,
  finishedAtMs: null,
};

/** The two counter maps added together, key by key. */
function addCounts(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): Record<string, number> {
  const summed: Record<string, number> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    summed[key] = (summed[key] ?? 0) + value;
  }

  return summed;
}

const OUTCOME_STATUS: Readonly<Record<string, InstantEvalStoredStatus>> = {
  finished: "FINISHED",
  failed: "FAILED",
  cancelled: "CANCELLED",
};

export function applyInstantEvalRunEvent(
  state: InstantEvalRunProjectionState,
  event: InstantEvalProcessingEvent,
): InstantEvalRunProjectionState {
  switch (event.type) {
    case INSTANT_EVAL_EVENT_TYPES.REQUESTED:
      return { ...state, status: "QUEUED" };

    case INSTANT_EVAL_EVENT_TYPES.PLANNED:
      return {
        ...state,
        status: state.finishedAtMs === null ? "RUNNING" : state.status,
        total: event.data.total,
        startedAtMs: state.startedAtMs ?? event.occurredAt,
      };

    case INSTANT_EVAL_EVENT_TYPES.PAGE_JUDGED:
      return {
        ...state,
        status: state.finishedAtMs === null ? "RUNNING" : state.status,
        progress: state.progress + event.data.rows,
        matched:
          event.data.matched === null ? state.matched : (state.matched ?? 0) + event.data.matched,
        matchedByQuestion: addCounts(state.matchedByQuestion, event.data.matchedByQuestion),
        failed: state.failed + event.data.failed,
        skipped: state.skipped + event.data.skipped,
        tokens: state.tokens + event.data.inputTokens,
        startedAtMs: state.startedAtMs ?? event.occurredAt,
      };

    case INSTANT_EVAL_EVENT_TYPES.CANCEL_REQUESTED:
      // The status does not move yet: the run is still judging whatever page it
      // holds, and reporting it cancelled before it stopped would be a lie a
      // caller would act on.
      return state;

    case INSTANT_EVAL_EVENT_TYPES.FINISHED:
      return {
        ...state,
        status: OUTCOME_STATUS[event.data.outcome] ?? "FAILED",
        error: event.data.errorCode,
        costUsd: event.data.costUsd,
        priceUsd: event.data.priceUsd,
        finishedAtMs: state.finishedAtMs ?? event.occurredAt,
      };

    default:
      return state;
  }
}

/**
 * The projection, as the builder mounts it. A plain definition rather than a
 * subclass of the fold base: the base derives handler names from event types
 * and keeps its own timestamps inside state, neither of which this needs.
 */
export function createInstantEvalRunProjection(deps: {
  store: StateProjectionStore<InstantEvalRunProjectionState>;
}): StateProjectionDefinition<InstantEvalRunProjectionState, InstantEvalProcessingEvent> {
  return {
    name: "instantEvalRun",
    version: INSTANT_EVAL_PROJECTION_VERSIONS.RUN,
    eventTypes: INSTANT_EVAL_PROCESSING_EVENT_TYPES,
    init: () => INITIAL_INSTANT_EVAL_RUN_STATE,
    apply: applyInstantEvalRunEvent,
    store: deps.store,
    // The aggregate is the run, so the projection key is the run id and one
    // row is one run.
    key: (event) => String(event.aggregateId),
  };
}
