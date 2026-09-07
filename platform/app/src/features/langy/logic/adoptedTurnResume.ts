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
