/**
 * Which turn does Stop actually stop?
 *
 * A stop names a turn. This tab only learns a turn id from its OWN send (the
 * transport's `beginTurn`), so a turn it merely ADOPTED — started in another
 * tab, or rejoined after a refresh — used to leave the composer showing Stop
 * with nothing behind it: the click moved the phase to `stopping` and no
 * request was ever sent. The agent kept running; the tab sat in a spinner until
 * the turn ended on its own.
 *
 * The fix is not a tab-to-tab message. A broadcast can only reach a tab that is
 * still open, and the worst case — the tab that started the turn is closed, or
 * the turn was rejoined after a full refresh — has no such tab by definition.
 * The durable record already names the turn it has in flight (`CurrentTurnId`
 * on the conversation fold, surfaced by `langy.messages` as `inFlightTurnId`),
 * so every tab can name the turn without having started it, and Stop works with
 * no sibling tab at all.
 *
 * Which id wins: this tab's own live turn, while it is still live. Its send is
 * newer than any projection, so it cannot be the stale one. Once this tab has
 * no unsettled turn of its own, the durable id is the only truth left.
 *
 * A send this tab has made but the server has not answered yet is newer still,
 * and its turn has no id here. The durable id may then be a turn that has
 * already ended (the projection lags both ways), so it is not offered: the
 * caller keeps the stop and sends it when the ids land (`stopPending`).
 *
 * PURE — `(ids) → target`, no store and no React — so the honesty rule is
 * testable directly: `dispatch` is the ONLY outcome the caller may show a
 * "stopping" state for.
 */

export type LangyStopTarget =
  | {
      kind: "dispatch";
      projectId: string;
      conversationId: string;
      turnId: string;
    }
  | {
      kind: "unavailable";
      /**
       * `no-conversation` — nothing is open to stop (a stale click).
       * `turn-not-identified` — a turn is in flight but no id names it yet.
       * That is the window between a message being sent and the server
       * answering with the ids. Nothing can be dispatched, so the caller keeps
       * the user's stop and dispatches it when an id arrives.
       */
      reason: "no-conversation" | "turn-not-identified";
    };

export function resolveLangyStopTarget({
  projectId,
  conversationId,
  localTurnId,
  localSettledTurnId,
  localSendPending = false,
  durableTurnId,
}: {
  projectId: string | null | undefined;
  conversationId: string | null;
  /** The turn THIS tab dispatched (`activeTurnId`), settled or not. */
  localTurnId: string | null;
  /** The turn a genuine end-of-turn frame settled (`settledTurnId`). */
  localSettledTurnId: string | null;
  /** Whether this tab sent a message the server has not answered with ids yet. */
  localSendPending?: boolean;
  /** The turn the durable record has in flight, or null if it names none. */
  durableTurnId: string | null;
}): LangyStopTarget {
  if (!projectId || !conversationId) {
    return { kind: "unavailable", reason: "no-conversation" };
  }
  const ownsLiveTurn =
    localTurnId !== null && localTurnId !== localSettledTurnId;
  const turnId = ownsLiveTurn
    ? localTurnId
    : localSendPending
      ? null
      : durableTurnId;
  if (!turnId) {
    return { kind: "unavailable", reason: "turn-not-identified" };
  }
  return { kind: "dispatch", projectId, conversationId, turnId };
}
