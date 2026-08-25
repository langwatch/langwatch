/**
 * The workbench's request machine, with the side effects attached.
 *
 * `./lwql-request-state` decides what each event means; this issues the
 * request, aborts it, and publishes the state to whoever is subscribed. It is a
 * plain object rather than a hook so that every rule the feature file names —
 * the in-flight guard, reload sending the *submitted* snapshot, a cancelled
 * answer changing nothing — is covered without a component tree.
 *
 * Nothing here reads or rewrites the SQL. The statement handed to {@link
 * LangWatchQLExecute} is the one the member typed, character for character:
 * the backend owns parsing and policy, and a second opinion in the browser
 * could only disagree with it.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import type { LangWatchQLQueryResult } from "@langwatch/analytics-contract";

import {
  initialLangWatchQLRequestState,
  type LangWatchQLAnswer,
  type LangWatchQLParameterValue,
  type LangWatchQLRequestAction,
  type LangWatchQLRequestState,
  type LangWatchQLSnapshot,
  type LangWatchQLTimeWindowValues,
  lwqlRequestReducer,
} from "./lwql-request-state";

/** What the request looks like on the wire. */
export interface LangWatchQLExecuteRequest {
  readonly sql: string;
  readonly parameters?: Readonly<Record<string, LangWatchQLParameterValue>>;
  /**
   * The period this submission reports over. Travels in its own field, never
   * among the named parameters — the backend refuses a request that puts a
   * reserved name there, because that is a chart pinning a window the surface
   * was supposed to own.
   */
  readonly timeWindow?: LangWatchQLTimeWindowValues;
}

/** How a submission reaches the server. */
export type LangWatchQLExecute = (
  request: LangWatchQLExecuteRequest,
  options: { signal: AbortSignal },
) => Promise<LangWatchQLQueryResult>;

export interface LangWatchQLRequestController {
  getState(): LangWatchQLRequestState;
  /** `useSyncExternalStore`'s contract: notify, then the reader calls getState. */
  subscribe(listener: () => void): () => void;
  setSql(sql: string): void;
  setParameters(parameters: Readonly<Record<string, LangWatchQLParameterValue>>): void;
  /**
   * Sets the period the next submission reports over, or clears it.
   *
   * Separate from {@link LangWatchQLRequestController.setParameters} because it
   * is not a parameter: the surface supplies it, and the backend refuses a
   * caller that tries to send it as one.
   */
  setTimeWindow(timeWindow: LangWatchQLTimeWindowValues | undefined): void;
  /** Submits the current draft. No-op while a request is in flight. */
  runQuery(): void;
  /**
   * Re-sends the LAST SUBMITTED snapshot, whatever the draft now says.
   *
   * Not what the toolbar's action calls, deliberately. `submitted` is the last
   * request, which is not always the one that produced the visible result: run
   * A, edit to B, run B, cancel, and `submitted` is B while the member is
   * looking at A's rows. A button reading "Reload" there would re-run B. The
   * toolbar therefore always submits the draft, which the label already
   * guarantees is byte-identical to the visible result when it reads "Reload".
   *
   * This stays the seam for a data-only refresh of the last request.
   */
  reload(): void;
  /**
   * Abandons the in-flight request, keeping whatever result was already on
   * screen. A no-op when nothing is in flight. The aborted request's answer,
   * should the transport deliver one anyway, carries a superseded submission id
   * and is dropped by the reducer.
   */
  cancel(): void;
  /** Aborts anything in flight and stops publishing. */
  dispose(): void;
}

/**
 * Drops the `parameters` key entirely when there are none, so an unparameterised
 * query sends the same request shape it would have sent before the parameters
 * editor existed.
 */
function requestFor(snapshot: LangWatchQLSnapshot): LangWatchQLExecuteRequest {
  const parameters = { ...snapshot.parameters };
  return {
    sql: snapshot.sql,
    ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
    ...(snapshot.timeWindow ? { timeWindow: snapshot.timeWindow } : {}),
  };
}

export function createLangWatchQLRequestController({
  execute,
  initialDraft,
}: {
  execute: LangWatchQLExecute;
  initialDraft?: LangWatchQLSnapshot;
}): LangWatchQLRequestController {
  let state = initialLangWatchQLRequestState(initialDraft);
  const listeners = new Set<() => void>();
  let pending: AbortController | null = null;

  /** Applies an action, publishes on change, and reports whether it changed. */
  const apply = (action: LangWatchQLRequestAction): boolean => {
    const next = lwqlRequestReducer(state, action);
    if (next === state) return false;
    state = next;
    for (const listener of listeners) listener();
    return true;
  };

  const send = (snapshot: LangWatchQLSnapshot): void => {
    // The reducer refuses a submission while one is in flight, and refusing
    // means returning the same state — so an unchanged state IS the guard.
    // Reading it here rather than re-deriving `isInFlight` keeps one rule.
    if (!apply({ type: "submitted", snapshot })) return;

    const submissionId = state.submissionId;
    const abort = new AbortController();
    pending = abort;

    const settle = (answer: LangWatchQLAnswer): void => {
      if (pending === abort) pending = null;
      // Dropped by the reducer when `submissionId` is no longer the awaited
      // one, which is every path where the request was abandoned. The reducer
      // also decides which snapshot the answer belongs to — the transport does
      // not get a say, because by the time it answers the draft has moved on.
      apply({ type: "settled", submissionId, answer });
    };

    void execute(requestFor(snapshot), { signal: abort.signal }).then(
      (result) => settle({ kind: "result", result }),
      (error: unknown) => settle({ kind: "error", error }),
    );
  };

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setSql(sql) {
      apply({ type: "sqlEdited", sql });
    },

    setParameters(parameters) {
      apply({ type: "parametersEdited", parameters: { ...parameters } });
    },

    setTimeWindow(timeWindow) {
      apply({ type: "timeWindowChanged", timeWindow });
    },

    runQuery() {
      send(state.draft);
    },

    reload() {
      const { submitted } = state;
      if (!submitted) return;
      send(submitted);
    },

    cancel() {
      if (!state.isInFlight) return;
      pending?.abort();
      pending = null;
      apply({ type: "abandoned" });
    },

    // Deliberately reusable rather than one-shot: a controller outlives a
    // remount of the component that owns it (React keeps it in state), and a
    // permanent "disposed" flag would leave that remounted workbench unable to
    // run anything ever again.
    dispose() {
      // Stop publishing before abandoning: the abandonment is bookkeeping for
      // an answer that may still arrive, and a subscriber being torn down has
      // no use for the notification.
      listeners.clear();
      pending?.abort();
      pending = null;
      apply({ type: "abandoned" });
    },
  };
}
