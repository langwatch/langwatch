/**
 * Browser's LOCAL turn projection: snapshot-then-tail in one pure module.
 * Same `foldLangyConversationTurn` reducer as server. Gapless/idempotent via
 * cursor (drop old events, advance on new). Only current turn stored. See
 * ADR-059 §2/§3.
 */
import { compareLangyEventCursors, type LangyEventCursor } from "./contracts/cursor.ts";
import type { LangyConversationTurnWireEvent } from "./contracts/turn-wire.ts";
import {
  foldLangyConversationTurn,
  initLangyConversationTurnState,
  type LangyConversationTurnFoldState,
} from "./folds/turn-fold.ts";

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
 * Seeds projection from snapshot: cursor + current turn id. Never regresses
 * (live tail beats query is no-op). Snapshot rendered state supersedes fold.
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
    (!snapshot.cursor || compareLangyEventCursors(snapshot.cursor, state.cursor) <= 0)
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
    const base = isNewTurn || next.turn === null ? initLangyConversationTurnState() : next.turn;
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
export function isLangyTurnProjectionTerminal(state: LangyTurnProjectionState): boolean {
  const status = state.turn?.Status;
  return status === "completed" || status === "failed" || status === "stopped";
}
