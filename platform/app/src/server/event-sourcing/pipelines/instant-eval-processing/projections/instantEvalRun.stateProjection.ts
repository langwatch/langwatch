/**
 * The run's counters, folded from its own events.
 *
 * A state projection, because what it maintains is one row a caller polls
 * every three seconds, and the state-projection contract is exactly that:
 * load, apply, store, no event-log recovery read and no cache hook. The row
 * lives in ClickHouse, in `instant_eval_runs`, a replacing table keyed by the
 * tenant and the run.
 *
 * It folds counters and nothing else. The run's definition, its name, its
 * statement, its questions and its row limit, is written once by the service
 * that accepted the run, and this projection never touches those columns. Two
 * reasons: a caller must be able to read a run back the instant it was
 * accepted rather than when a worker catches up, and a replay must be able to
 * rebuild the counters without rewriting what was asked.
 *
 * `apply` is a pure function of the previous state and the event, so a replay
 * from the run's first event reproduces the same row. Nothing here reads a
 * clock.
 *
 * @see ~/server/app-layer/instant-evals/run/instant-eval-run.repository.ts: the store this writes through
 * @see ../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import type {
  StateProjectionDefinition,
  StateProjectionStore,
} from "~/server/event-sourcing/projections/stateProjection.types";

import {
  INSTANT_EVAL_EVENT_TYPES,
  INSTANT_EVAL_PROCESSING_EVENT_TYPES,
  INSTANT_EVAL_PROJECTION_VERSIONS,
} from "../schemas/constants";
import type { InstantEvalProcessingEvent } from "../schemas/events";

/** The status a run reports, in the spelling the row stores. */
export type InstantEvalRunProjectedStatus =
  | "QUEUED"
  | "PLANNING"
  | "RUNNING"
  | "FINISHED"
  | "FAILED"
  | "CANCELLED";

/** Everything this projection maintains on a run's row. */
export interface InstantEvalRunProjectionState {
  readonly status: InstantEvalRunProjectedStatus;
  /** Rows the key pass found, or null before it ran. */
  readonly total: number | null;
  readonly progress: number;
  /**
   * Matches across the run's boolean questions, or null when it has none.
   *
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
/**
 * A page's boolean matches added to the run's running total.
 *
 * Null plus a number is that number: the first page that reports a match
 * count is what establishes that the run has a boolean question at all. Null
 * plus null stays null, which is the run that asked none.
 */
function addMatched(
  total: number | null,
  page: number | null | undefined,
): number | null {
  if (page === null || page === undefined) return total;
  return (total ?? 0) + page;
}

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

const OUTCOME_STATUS: Readonly<Record<string, InstantEvalRunProjectedStatus>> =
  {
    finished: "FINISHED",
    failed: "FAILED",
    cancelled: "CANCELLED",
  };

function applyEvent(
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
        matched: addMatched(state.matched, event.data.matched),
        matchedByQuestion: addCounts(
          state.matchedByQuestion,
          event.data.matchedByQuestion,
        ),
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
 * The projection, as the builder mounts it.
 *
 * A plain definition rather than a subclass of the fold base: the base derives
 * handler names from event types and maintains its own timestamp fields inside
 * state, neither of which this needs. Five events and one switch is the whole
 * of it.
 */
export function createInstantEvalRunStateProjection(deps: {
  store: StateProjectionStore<InstantEvalRunProjectionState>;
}): StateProjectionDefinition<
  InstantEvalRunProjectionState,
  InstantEvalProcessingEvent
> {
  return {
    name: "instantEvalRun",
    version: INSTANT_EVAL_PROJECTION_VERSIONS.RUN,
    eventTypes: INSTANT_EVAL_PROCESSING_EVENT_TYPES,
    init: () => INITIAL_INSTANT_EVAL_RUN_STATE,
    apply: applyEvent,
    store: deps.store,
    // The aggregate is the run, so the projection key is the run id and one
    // row is one run.
    key: (event) => String(event.aggregateId),
  };
}

export { applyEvent as applyInstantEvalRunEvent };
