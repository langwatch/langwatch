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
 * in `./governedSqlRequestController`, which is the only thing that calls this.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import type { GovernedSqlQueryResult } from "~/server/analytics/governed-sql";

/**
 * A bound parameter's value. Scalars only, matching what the API accepts — a
 * parameter is a value, not a structure.
 */
export type GovernedSqlParameterValue = string | number | boolean | null;

/** The statement and its parameters, taken together. */
export interface GovernedSqlSnapshot {
  readonly sql: string;
  readonly parameters: Readonly<Record<string, GovernedSqlParameterValue>>;
}

/**
 * What came back, before it is tied to the request that earned it.
 *
 * The transport knows this much and no more, which is why the reducer rather
 * than the caller decides which snapshot it belongs to.
 */
export type GovernedSqlAnswer =
  | { readonly kind: "result"; readonly result: GovernedSqlQueryResult }
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
export type GovernedSqlOutcome =
  | {
      readonly kind: "result";
      readonly result: GovernedSqlQueryResult;
      readonly snapshot: GovernedSqlSnapshot;
    }
  | {
      readonly kind: "error";
      readonly error: unknown;
      readonly snapshot: GovernedSqlSnapshot;
    };

export interface GovernedSqlRequestState {
  /** What the member is editing right now. */
  readonly draft: GovernedSqlSnapshot;
  /** What was last sent, byte for byte. `null` until the first submission. */
  readonly submitted: GovernedSqlSnapshot | null;
  /**
   * Identifies the submission whose answer is still wanted.
   *
   * Every submission and every abandonment moves it, so an answer that arrives
   * for a superseded or cancelled request carries a number the state no longer
   * recognises and is dropped. This is what makes cancellation correct even
   * when the transport delivers the response anyway.
   */
  readonly submissionId: number;
  readonly inFlight: boolean;
  /**
   * The visible answer, carrying the snapshot it belongs to. Not necessarily
   * {@link submitted}'s answer — a submission can be abandoned before it
   * produces one, leaving an older outcome on screen.
   */
  readonly outcome: GovernedSqlOutcome | null;
}

export type GovernedSqlRequestAction =
  | { readonly type: "sqlEdited"; readonly sql: string }
  | {
      readonly type: "parametersEdited";
      readonly parameters: Readonly<Record<string, GovernedSqlParameterValue>>;
    }
  | { readonly type: "submitted"; readonly snapshot: GovernedSqlSnapshot }
  | {
      readonly type: "settled";
      readonly submissionId: number;
      readonly answer: GovernedSqlAnswer;
    }
  /** The in-flight request is no longer wanted: cancelled, or the surface left. */
  | { readonly type: "abandoned" };

/** A workbench that has been opened and nothing run yet. */
export function initialGovernedSqlRequestState(
  draft: GovernedSqlSnapshot = { sql: "", parameters: {} },
): GovernedSqlRequestState {
  return {
    draft,
    submitted: null,
    submissionId: 0,
    inFlight: false,
    outcome: null,
  };
}

function parametersMatch(
  a: Readonly<Record<string, GovernedSqlParameterValue>>,
  b: Readonly<Record<string, GovernedSqlParameterValue>>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  // `Object.hasOwn` rather than a bare read: a parameter explicitly set to
  // `null` is a value the API accepts, and `b[key] === undefined` cannot tell
  // it apart from a key that is absent.
  return keys.every(
    (key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]),
  );
}

/** Whether two snapshots would produce byte-identical requests. */
export function governedSqlSnapshotsMatch(
  a: GovernedSqlSnapshot | null,
  b: GovernedSqlSnapshot | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.sql === b.sql && parametersMatch(a.parameters, b.parameters);
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
export function governedSqlRequestReducer(
  state: GovernedSqlRequestState,
  action: GovernedSqlRequestAction,
): GovernedSqlRequestState {
  switch (action.type) {
    case "sqlEdited":
      return withSql(state, action.sql);
    case "parametersEdited":
      return withParameters(state, action.parameters);
    case "submitted":
      return withSubmission(state, action.snapshot);
    case "settled":
      return withAnswer(state, action.submissionId, action.answer);
    case "abandoned":
      return abandoned(state);
  }
}

function withSql(
  state: GovernedSqlRequestState,
  sql: string,
): GovernedSqlRequestState {
  if (sql === state.draft.sql) return state;
  return { ...state, draft: { ...state.draft, sql } };
}

function withParameters(
  state: GovernedSqlRequestState,
  parameters: Readonly<Record<string, GovernedSqlParameterValue>>,
): GovernedSqlRequestState {
  if (parametersMatch(parameters, state.draft.parameters)) return state;
  return { ...state, draft: { ...state.draft, parameters } };
}

/** Refuses a second submission by returning the state unchanged. */
function withSubmission(
  state: GovernedSqlRequestState,
  snapshot: GovernedSqlSnapshot,
): GovernedSqlRequestState {
  if (state.inFlight) return state;
  return {
    ...state,
    submitted: snapshot,
    submissionId: state.submissionId + 1,
    inFlight: true,
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
  state: GovernedSqlRequestState,
  submissionId: number,
  answer: GovernedSqlAnswer,
): GovernedSqlRequestState {
  if (!state.inFlight || submissionId !== state.submissionId) return state;

  // Unreachable: only `withSubmission` sets `inFlight`, and it sets `submitted`
  // in the same breath. Guarded rather than asserted, because the cost of being
  // wrong is an outcome with no snapshot, which reads as never stale.
  const snapshot = state.submitted;
  if (!snapshot) return state;

  return {
    ...state,
    inFlight: false,
    outcome:
      answer.kind === "result"
        ? { kind: "result", result: answer.result, snapshot }
        : { kind: "error", error: answer.error, snapshot },
  };
}

function abandoned(state: GovernedSqlRequestState): GovernedSqlRequestState {
  if (!state.inFlight) return state;
  return { ...state, inFlight: false, submissionId: state.submissionId + 1 };
}

/**
 * Whether the visible outcome belongs to a snapshot the draft has since moved
 * away from.
 *
 * The result is not hidden when this is true — a member reading a table wants
 * to keep reading it while they edit the next query — it is *labelled*, which
 * is the difference between a stale answer and a lie.
 */
export function isGovernedSqlResultStale(
  state: GovernedSqlRequestState,
): boolean {
  if (state.outcome === null) return false;
  // Against the OUTCOME's snapshot, never `submitted`. The two differ whenever
  // a later submission was abandoned before it answered, and reading
  // `submitted` there declares an older answer current for a request it never
  // ran.
  return !governedSqlSnapshotsMatch(state.draft, state.outcome.snapshot);
}

/** What the primary action reads. */
export type GovernedSqlActionLabel = "Run query" | "Reload";

/**
 * `Reload` only while a successful result and the draft still describe the same
 * request. Anything else — an edit, a failure, nothing run yet — reads
 * `Run query`, because that is what pressing it would do.
 */
export function governedSqlActionLabel(
  state: GovernedSqlRequestState,
): GovernedSqlActionLabel {
  if (state.outcome?.kind !== "result") return "Run query";
  // The visible result's own snapshot, for the same reason staleness reads it:
  // `Reload` promises to re-run what produced what you are looking at, and only
  // this comparison can keep that promise.
  return governedSqlSnapshotsMatch(state.draft, state.outcome.snapshot)
    ? "Reload"
    : "Run query";
}
