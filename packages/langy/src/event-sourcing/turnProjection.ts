/**
 * The browser's LOCAL turn projection (ADR-059 §2/§3) — the whole
 * snapshot-then-tail state machine in one pure module, mirroring how
 * `turnPhase.ts` holds the whole send/stop machine.
 *
 * The client seeds it from the conversation snapshot (the projection's cursor
 * plus, when a turn is in flight, its id), then folds the durable event tail
 * through the SAME `foldLangyConversationTurn` reducer the server projection
 * runs. Gaplessness and idempotence both come from the cursor: an event at or
 * before the local cursor has already been folded (drop it), anything after
 * advances it. Replaying a tail is therefore always safe — which is what makes
 * the local state debuggable by re-running the reducer over a recorded tail.
 *
 * Only the CURRENT turn keeps a document here: a tail event for a NEW turn
 * replaces the document (past turns are rendered from message history, not
 * from this projection).
 */
import {
  compareLangyEventCursors,
  type LangyEventCursor,
} from "./contracts/cursor";
import type { LangyConversationTurnWireEvent } from "./contracts/turnWire";
import {
  foldLangyConversationTurn,
  initLangyConversationTurnState,
  type LangyConversationTurnFoldState,
} from "./folds/turnFold";

export interface LangyTurnProjectionState {
  /** Position of the last folded event; null before the snapshot seeds it. */
  cursor: LangyEventCursor | null;
  /** The turn the local document tracks (the newest seen). */
  turnId: string | null;
  /** The current turn's folded document; null when no turn has been seen. */
  turn: LangyConversationTurnFoldState | null;
}

export const initialLangyTurnProjection: LangyTurnProjectionState = {
  cursor: null,
  turnId: null,
  turn: null,
};

/**
 * Adopt a conversation snapshot: the projection's cursor, and — when the
 * snapshot says a turn is in flight — which turn, so a refresh mid-turn knows
 * what to reattach to before any tail arrives. Resets the folded document:
 * the snapshot's rendered state (messages, status) supersedes it.
 *
 * NEVER regresses: a re-fetched snapshot at or behind the local fold's cursor
 * (the live tail beat the query) is a no-op — the local fold is the fresher
 * truth and rewinding it would replay-flicker the turn.
 */
export function seedLangyTurnProjection(
  state: LangyTurnProjectionState,
  snapshot: {
    cursor: LangyEventCursor | null;
    currentTurnId?: string | null;
  },
): LangyTurnProjectionState {
  if (
    state.cursor &&
    (!snapshot.cursor ||
      compareLangyEventCursors(snapshot.cursor, state.cursor) <= 0)
  ) {
    return state;
  }
  return {
    cursor: snapshot.cursor,
    turnId: snapshot.currentTurnId ?? null,
    turn: null,
  };
}

/**
 * Fold a fetched tail. Pure, idempotent, order-tolerant BETWEEN calls: events
 * at or before the cursor are dropped, so overlapping fetches and re-delivered
 * signals are harmless. Within one call events are folded in the order served
 * (the tail read orders by cursor).
 */
export function applyLangyTurnEvents(
  state: LangyTurnProjectionState,
  events: readonly LangyConversationTurnWireEvent[],
): LangyTurnProjectionState {
  let next = state;
  for (const event of events) {
    const at: LangyEventCursor = {
      acceptedAt: event.createdAt,
      eventId: event.id,
    };
    if (next.cursor && compareLangyEventCursors(at, next.cursor) <= 0) {
      continue;
    }
    const isNewTurn = next.turnId !== event.data.turnId;
    const base =
      isNewTurn || next.turn === null
        ? initLangyConversationTurnState()
        : next.turn;
    next = {
      cursor: at,
      turnId: event.data.turnId,
      turn: foldLangyConversationTurn(base, event),
    };
  }
  return next;
}

/**
 * Is the locally-folded current turn at a terminal? Used to know when message
 * history has new durable content to reconcile (the answer lands on the
 * message projection at the same terminal), and to settle the phase machine.
 */
export function isLangyTurnProjectionTerminal(
  state: LangyTurnProjectionState,
): boolean {
  const status = state.turn?.Status;
  return (
    status === "completed" || status === "failed" || status === "stopped"
  );
}
