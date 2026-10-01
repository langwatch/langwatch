/**
 * Whether the panel reattaches its chat engine to a turn it did not dispatch. A turn adopted from
 * the durable fold (server-started, another tab's, a refresh mid-turn) has no stream open here,
 * so its text as written and its live-only instructions never arrive until the tab resumes.
 * @see specs/langy/langy-frontend-realtime.feature
 */

/**
 * Resume exactly once per adopted turn, and only once the engine's last message is the turn's own
 * user message: the resumed stream writes into the LAST engine message when that is an assistant
 * one, which would append this turn's words to the previous reply.
 */
export function shouldResumeAdoptedTurn(params: {
  /** The phase machine says a turn is in flight. */
  turnActive: boolean;
  /** The turn the store tracks, from a send or from the durable record. */
  activeTurnId: string | null;
  /** The turn this tab's own send started, if any. */
  dispatchedTurnId: string | null;
  /** The turn this tab already resumed, if any. */
  resumedTurnId: string | null;
  /** The engine is already streaming (submitted/streaming). */
  isStreaming: boolean;
  /** A user selection is loading; that effect owns the engine. */
  isHistoryLoadPending: boolean;
  /** The role of the engine's last message, `null` when it holds none. */
  lastEngineRole: string | null;
}): boolean {
  if (!params.turnActive || !params.activeTurnId) return false;
  if (params.activeTurnId === params.dispatchedTurnId) return false;
  if (params.activeTurnId === params.resumedTurnId) return false;
  if (params.isStreaming) return false;
  if (params.isHistoryLoadPending) return false;
  return params.lastEngineRole === "user";
}

/**
 * Whether to re-read the transcript because the local fold moved on to a turn it does not show.
 * The transcript is re-read only on an open or its own in-flight poll, so without this one read an
 * adopted turn's user message never lands and the resume above waits for the turn's whole run.
 */
export function shouldRefetchHistoryForAdoptedTurn(params: {
  /** The phase machine says a turn is in flight. */
  turnActive: boolean;
  /** The turn the store tracks, from a send or from the durable record. */
  activeTurnId: string | null;
  /** The turn this tab's own send started, if any. */
  dispatchedTurnId: string | null;
  /** The turn the durable transcript snapshot names as in flight, if any. */
  foldInFlightTurnId: string | null;
  /** The turn this tab already re-read the transcript for, if any. */
  refetchedTurnId: string | null;
  /** The panel is holding a transcript that the fold can have outgrown. */
  hasHistory: boolean;
  /** A transcript read is already in flight; wait for it to settle. */
  isFetchingHistory: boolean;
}): boolean {
  if (!params.turnActive || !params.activeTurnId) return false;
  // Nothing read yet: the read that is coming carries the turn already.
  if (!params.hasHistory) return false;
  // This tab's own send brought its stream, and its transcript grows from it.
  if (params.activeTurnId === params.dispatchedTurnId) return false;
  // The snapshot already knows this turn, so it carries its user message.
  if (params.activeTurnId === params.foldInFlightTurnId) return false;
  if (params.activeTurnId === params.refetchedTurnId) return false;
  return !params.isFetchingHistory;
}
