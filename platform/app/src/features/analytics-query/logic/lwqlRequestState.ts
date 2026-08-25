/**
 * The workbench's request state: draft, submitted snapshot, and the outcome
 * that belongs to that snapshot.
 *
 * Three facts, kept apart on purpose. The draft is what the member is typing;
 * the submitted snapshot is what the database was actually asked; the outcome
 * belongs to the *submitted* snapshot and never to the draft. Collapsing any
 * two of them is how a result comes to look current for a statement that was
 * never run — the failure this whole module exists to make impossible.
 *
 * Pure and DOM-free: a reducer plus selectors, so every transition is covered
 * without rendering. The side effects (issuing the request, aborting it) live
 * in `./lwqlRequestController`, which is the only thing that calls this.
 *
 * @see specs/analytics/lwql-workbench.feature
 */

import type { LangWatchQLQueryResult } from "~/server/analytics/lwql";

/**
 * A bound parameter's value. Scalars only, matching what the API accepts — a
 * parameter is a value, not a structure.
 */
export type LangWatchQLParameterValue = string | number | boolean | null;

/**
 * The period a submission reports over, as instants.
 *
 * Epoch milliseconds rather than `Date`, so a snapshot stays comparable by
 * value — two `Date` objects for the same instant are never `Object.is`-equal,
 * and a staleness test built on them would call every result stale on the next
 * render. Epoch milliseconds are also what `useFilterParams` already hands the
 * rest of the analytics surfaces.
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
   * The window the surface supplies for the reserved `period_start` /
   * `period_end` parameters. Part of the snapshot because it is part of the
   * request: a result produced for last week's period is not current for this
   * week's, and only a snapshot that carries it can say so.
   *
   * Absent on a workbench with no page period behind it, which is every caller
   * that only ever writes unbounded statements.
   */
  readonly timeWindow?: LangWatchQLTimeWindowValues;
}

/**
 * What came back, before it is tied to the request that earned it.
 *
 * The transport knows this much and no more, which is why the reducer rather
 * than the caller decides which snapshot it belongs to.
 */
export type LangWatchQLAnswer =
  | { readonly kind: "result"; readonly result: LangWatchQLQueryResult }
  | { readonly kind: "error"; readonly error: unknown };

/**
 * An answer and the snapshot that produced it.
 *
 * The snapshot rides on the outcome rather than being read off `submitted`,
 * and that is the whole of what makes staleness honest. `submitted` is the LAST
 * request, not the one the visible answer came from, and the two come apart the
 * moment a second submission is cancelled: run A, edit to B, run B, abandon.
 * `submitted` is then B while the visible result is still A's, so a staleness
 * test reading `submitted` would call A's rows current for B and offer to
 * "Reload" them.
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
   * Identifies the submission whose answer is still wanted.
   *
   * Every submission and every abandonment moves it, so an answer that arrives
   * for a superseded or cancelled request carries a number the state no longer
   * recognises and is dropped. This is what makes cancellation correct even
   * when the transport delivers the response anyway.
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
  // `null` is a value the API accepts, and `b[key] === undefined` cannot tell
  // it apart from a key that is absent.
  return keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}

function timeWindowsMatch(
  a: LangWatchQLTimeWindowValues | undefined,
  b: LangWatchQLTimeWindowValues | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
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
    timeWindowsMatch(a.timeWindow, b.timeWindow)
  );
}

/**
 * The one transition function.
 *
 * Two refusals are load-bearing and both are here rather than at the call site,
 * so that no caller can forget them:
 *
 *  - a submission while one is in flight returns the state unchanged, which is
 *    what the controller reads as "do not issue a second request";
 *  - an answer whose `submissionId` is not the one being awaited is dropped,
 *    which is what makes an aborted or superseded response harmless.
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
 * Drops an answer for a submission that is no longer the one being awaited, and
 * otherwise records it against the snapshot that produced it.
 *
 * That snapshot is `state.submitted`: the id matched, so nothing has been
 * submitted since this request went out. Binding it here — the one moment the
 * two are provably the same request — is what lets every reader downstream
 * compare against the answer's own snapshot instead of the latest one.
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
 * Whether the visible outcome belongs to a snapshot the draft has since moved
 * away from.
 *
 * The result is not hidden when this is true — a member reading a table wants
 * to keep reading it while they edit the next query — it is *labelled*, which
 * is the difference between a stale answer and a lie.
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
