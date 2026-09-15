/**
 * Draft, submitted snapshot, and outcome are kept apart: the outcome belongs
 * to the *submitted* snapshot, never the draft — collapsing any two is how a
 * stale result comes to look current. See analytics-lwql-workbench.feature.
 */

import type {
  LangWatchQLGranularityStep,
  LangWatchQLQueryResult,
} from "@langwatch/analytics-contract";

/**
 * A bound parameter's value. Scalars only, matching what the API accepts — a
 * parameter is a value, not a structure.
 */
export type LangWatchQLParameterValue = string | number | boolean | null;

/**
 * The period a submission reports over, as instants: epoch milliseconds, not
 * `Date` — two `Date` objects for the same instant are never `Object.is`-equal,
 * so a staleness test built on them would call every result stale on render.
 */
export interface LangWatchQLTimeWindowValues {
  readonly start: number;
  readonly end: number;
}

/** The statement, its parameters and the period it reports over, taken together. */
export interface LangWatchQLSnapshot {
  readonly sql: string;
  readonly parameters: Readonly<Record<string, LangWatchQLParameterValue>>;
  /**
   * The window for the reserved `dashboard_context_period_start`/`_end` params.
   * Part of the snapshot because a result for last week's period is not
   * current for this week's, and only a snapshot carrying it can say so.
   */
  readonly timeWindow?: LangWatchQLTimeWindowValues;
  /**
   * The step for the reserved `dashboard_context_granularity_seconds` param —
   * kept for the same reason as the window: an hourly bucket isn't the answer
   * to a by-the-second question, and only a snapshot carrying it can tell.
   */
  readonly granularitySeconds?: LangWatchQLGranularityStep;
}

/**
 * What came back, before it is tied to the request that earned it — the
 * transport knows this much and no more, which is why the reducer rather
 * than the caller decides which snapshot it belongs to.
 */
export type LangWatchQLAnswer =
  | { readonly kind: "result"; readonly result: LangWatchQLQueryResult }
  | { readonly kind: "error"; readonly error: unknown };

/**
 * An answer and the snapshot that produced it, riding on the outcome rather
 * than `submitted` — `submitted` is the LAST request, not the one the visible
 * answer came from; they part when a second submission is cancelled but the first still shows.
 */
export type LangWatchQLOutcome =
  | {
      readonly kind: "result";
      readonly result: LangWatchQLQueryResult;
      readonly snapshot: LangWatchQLSnapshot;
    }
  | {
      readonly kind: "error";
      readonly error: unknown;
      readonly snapshot: LangWatchQLSnapshot;
    };

export interface LangWatchQLRequestState {
  /** What the member is editing right now. */
  readonly draft: LangWatchQLSnapshot;
  /** What was last sent, byte for byte. `null` until the first submission. */
  readonly submitted: LangWatchQLSnapshot | null;
  /**
   * Identifies the submission whose answer is still wanted: every submission
   * and abandonment moves it, so a stale answer carries a number the state no
   * longer recognises and is dropped — correct cancellation even if transport delivers it.
   */
  readonly submissionId: number;
  readonly isInFlight: boolean;
  /**
   * The visible answer, carrying the snapshot it belongs to. Not necessarily
   * {@link submitted}'s answer — a submission can be abandoned before it
   * produces one, leaving an older outcome on screen.
   */
  readonly outcome: LangWatchQLOutcome | null;
}

export type LangWatchQLRequestAction =
  | { readonly type: "sqlEdited"; readonly sql: string }
  | {
      readonly type: "parametersEdited";
      readonly parameters: Readonly<Record<string, LangWatchQLParameterValue>>;
    }
  | {
      readonly type: "timeWindowChanged";
      readonly timeWindow: LangWatchQLTimeWindowValues | undefined;
    }
  | {
      readonly type: "granularityChanged";
      readonly granularitySeconds: LangWatchQLGranularityStep | undefined;
    }
  | { readonly type: "submitted"; readonly snapshot: LangWatchQLSnapshot }
  | {
      readonly type: "settled";
      readonly submissionId: number;
      readonly answer: LangWatchQLAnswer;
    }
  /** The in-flight request is no longer wanted: cancelled, or the surface left. */
  | { readonly type: "abandoned" };

/** A workbench that has been opened and nothing run yet. */
export function initialLangWatchQLRequestState(
  draft: LangWatchQLSnapshot = { sql: "", parameters: {} },
): LangWatchQLRequestState {
  return {
    draft,
    submitted: null,
    submissionId: 0,
    isInFlight: false,
    outcome: null,
  };
}

function parametersMatch(
  a: Readonly<Record<string, LangWatchQLParameterValue>>,
  b: Readonly<Record<string, LangWatchQLParameterValue>>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  // `Object.hasOwn` rather than a bare read: a parameter explicitly set to
  // `null` is a value the API accepts, and `b[key] === void 0` cannot tell
  // it apart from a key that is absent.
  return keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}

function timeWindowsMatch(
  a: LangWatchQLTimeWindowValues | undefined,
  b: LangWatchQLTimeWindowValues | undefined,
): boolean {
  if (a === void 0 || b === void 0) return a === b;
  return a.start === b.start && a.end === b.end;
}

/** Whether two snapshots would produce byte-identical requests. */
export function lwqlSnapshotsMatch(
  a: LangWatchQLSnapshot | null,
  b: LangWatchQLSnapshot | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.sql === b.sql &&
    parametersMatch(a.parameters, b.parameters) &&
    timeWindowsMatch(a.timeWindow, b.timeWindow) &&
    a.granularitySeconds === b.granularitySeconds
  );
}

/**
 * The one transition function: two refusals live here, not the call site, so
 * no caller can forget them — a submission while one is in flight is a no-op,
 * and an answer whose `submissionId` isn't awaited is dropped.
 */
export function lwqlRequestReducer(
  state: LangWatchQLRequestState,
  action: LangWatchQLRequestAction,
): LangWatchQLRequestState {
  switch (action.type) {
    case "sqlEdited":
      return withSql(state, action.sql);
    case "parametersEdited":
      return withParameters(state, action.parameters);
    case "timeWindowChanged":
      return withTimeWindow(state, action.timeWindow);
    case "granularityChanged":
      return withGranularity({
        state,
        granularitySeconds: action.granularitySeconds,
      });
    case "submitted":
      return withSubmission(state, action.snapshot);
    case "settled":
      return withAnswer(state, action.submissionId, action.answer);
    case "abandoned":
      return abandoned(state);
  }
}

function withSql(state: LangWatchQLRequestState, sql: string): LangWatchQLRequestState {
  if (sql === state.draft.sql) return state;
  return { ...state, draft: { ...state.draft, sql } };
}

function withParameters(
  state: LangWatchQLRequestState,
  parameters: Readonly<Record<string, LangWatchQLParameterValue>>,
): LangWatchQLRequestState {
  if (parametersMatch(parameters, state.draft.parameters)) return state;
  return { ...state, draft: { ...state.draft, parameters } };
}

function withTimeWindow(
  state: LangWatchQLRequestState,
  timeWindow: LangWatchQLTimeWindowValues | undefined,
): LangWatchQLRequestState {
  if (timeWindowsMatch(timeWindow, state.draft.timeWindow)) return state;
  const { timeWindow: _dropped, ...rest } = state.draft;
  return {
    ...state,
    draft: { ...rest, ...(timeWindow ? { timeWindow } : {}) },
  };
}

function withGranularity({
  state,
  granularitySeconds,
}: {
  state: LangWatchQLRequestState;
  granularitySeconds: LangWatchQLGranularityStep | undefined;
}): LangWatchQLRequestState {
  if (granularitySeconds === state.draft.granularitySeconds) return state;
  // Dropped rather than set to `undefined`, matching the window above: the
  // request builder spreads the draft, and a present-but-undefined key is a
  // different request shape from an absent one.
  const { granularitySeconds: _dropped, ...rest } = state.draft;
  return {
    ...state,
    draft: {
      ...rest,
      ...(granularitySeconds !== undefined ? { granularitySeconds } : {}),
    },
  };
}

/** Refuses a second submission by returning the state unchanged. */
function withSubmission(
  state: LangWatchQLRequestState,
  snapshot: LangWatchQLSnapshot,
): LangWatchQLRequestState {
  if (state.isInFlight) return state;
  return {
    ...state,
    submitted: snapshot,
    submissionId: state.submissionId + 1,
    isInFlight: true,
  };
}

/**
 * Drops an answer no longer awaited; otherwise records it against
 * `state.submitted` — the one moment id-matching proves they're the same
 * request — so readers downstream compare against the answer's own snapshot.
 */
function withAnswer(
  state: LangWatchQLRequestState,
  submissionId: number,
  answer: LangWatchQLAnswer,
): LangWatchQLRequestState {
  if (!state.isInFlight || submissionId !== state.submissionId) return state;

  // Unreachable: only `withSubmission` sets `isInFlight`, and it sets `submitted`
  // in the same breath. Guarded rather than asserted, because the cost of being
  // wrong is an outcome with no snapshot, which reads as never stale.
  const snapshot = state.submitted;
  if (!snapshot) return state;

  return {
    ...state,
    isInFlight: false,
    outcome:
      answer.kind === "result"
        ? { kind: "result", result: answer.result, snapshot }
        : { kind: "error", error: answer.error, snapshot },
  };
}

function abandoned(state: LangWatchQLRequestState): LangWatchQLRequestState {
  if (!state.isInFlight) return state;
  return { ...state, isInFlight: false, submissionId: state.submissionId + 1 };
}

/**
 * Whether the visible outcome's snapshot is one the draft has since moved
 * away from. Not hidden when true — a member reading a table keeps reading
 * while they edit the next query — it is *labelled*, the line between stale and a lie.
 */
export function isLangWatchQLResultStale(state: LangWatchQLRequestState): boolean {
  if (state.outcome === null) return false;
  // Against the OUTCOME's snapshot, never `submitted`. The two differ whenever
  // a later submission was abandoned before it answered, and reading
  // `submitted` there declares an older answer current for a request it never
  // ran.
  return !lwqlSnapshotsMatch(state.draft, state.outcome.snapshot);
}

/** What the primary action reads. */
export type LangWatchQLActionLabel = "Run query" | "Reload";

/**
 * `Reload` only while a successful result and the draft still describe the same
 * request. Anything else — an edit, a failure, nothing run yet — reads
 * `Run query`, because that is what pressing it would do.
 */
export function lwqlActionLabel(state: LangWatchQLRequestState): LangWatchQLActionLabel {
  if (state.outcome?.kind !== "result") return "Run query";
  // The visible result's own snapshot, for the same reason staleness reads it:
  // `Reload` promises to re-run what produced what you are looking at, and only
  // this comparison can keep that promise.
  return lwqlSnapshotsMatch(state.draft, state.outcome.snapshot) ? "Reload" : "Run query";
}
