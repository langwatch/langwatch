/**
 * Which turn does Stop actually stop?
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
       * `turn-not-identified` — a turn is in flight but neither this tab nor the
       * durable record can name it yet.
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
  const ownsLiveTurn = localTurnId !== null && localTurnId !== localSettledTurnId;
  // A send this tab made but the server has not answered is newer than the durable id, and its
  // turn has no id here. The durable id may then name a turn that already ended, so it is not
  // offered: the caller keeps the stop and sends it when the ids land (`stopPending`).
  const turnId = ownsLiveTurn ? localTurnId : localSendPending ? null : durableTurnId;
  if (!turnId) {
    return { kind: "unavailable", reason: "turn-not-identified" };
  }
  return { kind: "dispatch", projectId, conversationId, turnId };
}
