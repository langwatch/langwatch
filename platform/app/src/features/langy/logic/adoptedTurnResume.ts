/**
 * Decides whether the Langy panel should reattach its chat engine to a turn it
 * did not dispatch.
 *
 * A turn reaches a tab in two ways. A send from this tab opens the stream
 * inside the transport, so every entry lands. A turn started anywhere else (the
 * server when the shared folder connects, another tab, a page refresh mid-turn)
 * is adopted from the durable fold: the tab learns the turn id, its tool calls
 * and its waits, but no stream is open, so the text as it is written and the
 * live-only instructions (navigate, ui) never arrive. Resuming opens that
 * stream; the subscription replays the buffered prefix first.
 *
 * Resume exactly once per adopted turn, and only when the engine is ready for
 * it: the resumed stream writes into the LAST engine message when that is an
 * assistant message, which would append this turn's words to the previous
 * reply. The durable history carries the turn's own user message (the
 * folder-connected notice, the other tab's question), so the engine is ready
 * once that message is the last one.
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
  if (params.lastEngineRole !== "user") return false;
  return true;
}

/**
 * Decides whether the panel should re-read the durable transcript because the
 * LOCAL fold has moved on to a turn the transcript does not show yet.
 *
 * The fold and the transcript are two different reads. The fold (ADR-059)
 * advances event by event off the freshness signal, so a turn started elsewhere
 * is adopted within a signal batch. The transcript (`langy.messages`) is
 * re-read only on an explicit open, or on its own in-flight poll — and that
 * poll is armed by the transcript's OWN in-flight flag, which a snapshot taken
 * before the turn existed says nothing about. So a tab that adopted a
 * server-started turn (the shared folder connecting) held the previous turn's
 * transcript for the turn's whole run: the engine never gained the new turn's
 * user message, `shouldResumeAdoptedTurn` stayed blocked on its engine-ready
 * guard, and nothing ever opened the turn's stream — losing every live-only
 * entry it carried, navigate included.
 *
 * One re-read per adopted turn is enough: it lands the turn's user message,
 * which readies the engine for the resume, and it re-arms the in-flight poll
 * that keeps the transcript fresh for the rest of the turn.
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
  // No transcript to be stale: nothing has been read for this conversation
  // yet, and the read that is coming carries the turn already.
  if (!params.hasHistory) return false;
  // This tab's own send brought its stream with it, and its transcript grows
  // from that stream.
  if (params.activeTurnId === params.dispatchedTurnId) return false;
  // The snapshot already knows this turn, so the transcript already carries
  // its user message — there is nothing to catch up on.
  if (params.activeTurnId === params.foldInFlightTurnId) return false;
  if (params.activeTurnId === params.refetchedTurnId) return false;
  if (params.isFetchingHistory) return false;
  return true;
}
