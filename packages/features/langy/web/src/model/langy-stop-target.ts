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
  durableTurnId,
}: {
  projectId: string | null | undefined;
  conversationId: string | null;
  /** The turn THIS tab dispatched (`activeTurnId`), settled or not. */
  localTurnId: string | null;
  /** The turn a genuine end-of-turn frame settled (`settledTurnId`). */
  localSettledTurnId: string | null;
  /** The turn the durable record has in flight, or null if it names none. */
  durableTurnId: string | null;
}): LangyStopTarget {
  if (!projectId || !conversationId) {
    return { kind: "unavailable", reason: "no-conversation" };
  }
  const ownsLiveTurn = localTurnId !== null && localTurnId !== localSettledTurnId;
  const turnId = ownsLiveTurn ? localTurnId : durableTurnId;
  if (!turnId) {
    return { kind: "unavailable", reason: "turn-not-identified" };
  }
  return { kind: "dispatch", projectId, conversationId, turnId };
}
