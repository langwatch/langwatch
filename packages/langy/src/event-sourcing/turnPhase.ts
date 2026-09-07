/**
 * The Langy turn phase state machine (ADR-078) — the whole thing, in one file.
 *
 * It is the SINGLE source for the composer's send/stop affordance and every
 * "is a turn in flight" read, replacing the old scatter of isBusy /
 * serverTurnInFlight / isStopping / settled-marker booleans that were derived
 * per-render across the panel.
 *
 *   idle ──beginSend/beginTurn──▶ active ──requestStop──▶ stopping
 *     ▲                             │   ◀──abandonStop───    │
 *     ├────────abandonSend──────────┘                        │
 *     └───────settleTurn / observeBackendTurn(false)──────────┘
 *
 * A SEND enters `active` with no turn id yet (`beginSend`): the composer shows
 * Stop from the moment the message leaves the field, not from the moment the
 * server answers with the ids, which on a cold worker is 6 to 12 seconds later.
 * A Stop clicked in that window has no turn to name, so it is REMEMBERED
 * (`stopPending`) and dispatched by the caller as soon as an id exists — from
 * this tab's own send (`beginTurn`) or from the durable record.
 *
 * These are PURE transitions — `(state, arg) → next state`, no Zustand and no
 * React — so the machine is trivially unit-testable and the store wires them in
 * a few lines (see langyStore.ts). `settledTurnId` and `backendSawTurnInFlight`
 * are internal bookkeeping: they absorb the durable fold's projection lag on
 * BOTH edges so the phase never flickers active↔idle while a send is settling.
 */

export type LangyTurnPhase = "idle" | "active" | "stopping";

export interface TurnPhaseState {
  turnPhase: LangyTurnPhase;
  /** The in-flight turn id this tab tracks (Stop target + live-signal routing). */
  activeTurnId: string | null;
  /** The turn a genuine end-of-turn frame settled (suppresses fold re-assertion). */
  settledTurnId: string | null;
  /** Whether the durable fold has CONFIRMED the current turn in flight yet. */
  backendSawTurnInFlight: boolean;
  /**
   * A Stop the user asked for that no request has gone out for yet, because no
   * turn id existed to name. The caller dispatches it the moment one does and
   * calls `stopDispatched`; until then the phase is `stopping` and the control
   * shows its spinner, which is honest: the stop is on its way.
   */
  stopPending: boolean;
}

export const initialTurnPhaseState: TurnPhaseState = {
  turnPhase: "idle",
  activeTurnId: null,
  settledTurnId: null,
  backendSawTurnInFlight: false,
  stopPending: false,
};

/**
 * The user sent a message: go `active` immediately, with no turn id yet.
 *
 * The ids arrive when the create/continue mutation answers, which on a cold
 * worker is many seconds after the send. Waiting for them left the composer
 * showing Send for that whole window, so a message sent by accident could not
 * be called back.
 */
export function beginSend(_state: TurnPhaseState): TurnPhaseState {
  return {
    turnPhase: "active",
    activeTurnId: null,
    settledTurnId: null,
    backendSawTurnInFlight: false,
    stopPending: false,
  };
}

/**
 * A turn was dispatched (the transport adopted its ids): adopt it, go `active`,
 * and forget the previous turn's settle marker + fold confirmation.
 *
 * A stop the user asked for during the send survives: the phase stays
 * `stopping` and the pending flag rides along, so the caller can dispatch it
 * against the id this transition just supplied.
 */
export function beginTurn(state: TurnPhaseState, turnId: string): TurnPhaseState {
  return {
    turnPhase: state.turnPhase === "stopping" ? "stopping" : "active",
    activeTurnId: turnId,
    settledTurnId: null,
    backendSawTurnInFlight: false,
    stopPending: state.stopPending,
  };
}

/**
 * The user hit Stop: `active` → `stopping` (a no-op in any other phase).
 *
 * `dispatched` is whether the caller could name a turn and send the request
 * right away. False means the send has not been answered yet, so the intent is
 * remembered and dispatched once an id exists.
 */
export function requestStop(
  state: TurnPhaseState,
  { dispatched = true }: { dispatched?: boolean } = {},
): TurnPhaseState {
  return state.turnPhase === "active"
    ? { ...state, turnPhase: "stopping", stopPending: !dispatched }
    : state;
}

/**
 * Whether this tab is waiting on ids for a message it just sent.
 *
 * Not the same as "a turn is in flight with no id here": a turn adopted from
 * the durable record (another tab, a reload) also has no local id, but its id
 * is the record's to supply. This one is THIS tab's send, still unanswered, so
 * the record cannot yet be naming its turn — see `resolveLangyStopTarget`.
 */
export function isSendUnanswered(state: TurnPhaseState): boolean {
  return (
    state.turnPhase !== "idle" &&
    state.activeTurnId === null &&
    !state.backendSawTurnInFlight
  );
}

/** The pending stop went out: the phase stays `stopping`, nothing is owed. */
export function stopDispatched(state: TurnPhaseState): TurnPhaseState {
  return state.stopPending ? { ...state, stopPending: false } : state;
}

/**
 * The send failed before any turn id existed: back to `idle`.
 *
 * There is nothing on the record to stop and nothing to wait for, so a stop the
 * user asked for during the send is dropped with it — the composer takes their
 * words back (see `langyDraftToRestore`) and shows Send again. A failure AFTER
 * the turn was identified is a different story, told by the turn's own
 * terminal, so this is a no-op once an id is known.
 */
export function abandonSend(state: TurnPhaseState): TurnPhaseState {
  if (state.turnPhase === "idle" || state.activeTurnId !== null) return state;
  return {
    ...state,
    turnPhase: "idle",
    stopPending: false,
    backendSawTurnInFlight: false,
  };
}

/**
 * The stop request never reached the backend: `stopping` → `active`.
 *
 * `stopping` is a promise to the user that a stop is on its way, so it may only
 * survive a request that actually went out. A rejected mutation leaves the turn
 * running on the durable record, and the honest thing to show is the running
 * turn's Stop button — not a spinner for a stop nobody is performing. If the
 * turn did in fact end, the fold settles it to `idle` on its next read.
 */
export function abandonStop(state: TurnPhaseState): TurnPhaseState {
  return state.turnPhase === "stopping"
    ? { ...state, turnPhase: "active", stopPending: false }
    : state;
}

/**
 * The durable fold reported whether a turn is in flight — the tab-independent
 * truth. Feeds `active` for a turn this tab did not start (another tab, a resume
 * after refresh) and settles to `idle` once the fold that CONFIRMED the turn
 * goes idle. Never keyed on the client stream's flaky isBusy — that is exactly
 * how a premature second send used to slip through and 409 the in-flight turn.
 */
export function observeBackendTurn(
  state: TurnPhaseState,
  inFlight: boolean,
): TurnPhaseState {
  const alreadySettled =
    state.activeTurnId !== null && state.settledTurnId === state.activeTurnId;
  if (inFlight) {
    // Ignore the fold re-asserting a turn the stream already ended (its
    // projection lags the end frame); otherwise adopt it, going active unless
    // the user is mid-stop.
    if (alreadySettled) return state;
    return {
      ...state,
      backendSawTurnInFlight: true,
      turnPhase: state.turnPhase === "stopping" ? "stopping" : "active",
    };
  }
  // The fold says no turn. Only settle if it had CONFIRMED one — a bare false
  // right after a send is just the projection lagging and must not flicker
  // active→idle→active.
  if (!state.backendSawTurnInFlight) return state;
  return {
    ...state,
    turnPhase: "idle",
    backendSawTurnInFlight: false,
    stopPending: false,
  };
}

/** A genuine end-of-turn frame settled the turn: go `idle` immediately. */
export function settleTurn(
  state: TurnPhaseState,
  turnId: string | null,
): TurnPhaseState {
  // A stale end frame for a superseded turn does not settle the new one.
  if (
    turnId !== null &&
    state.activeTurnId !== null &&
    turnId !== state.activeTurnId
  ) {
    return state;
  }
  return {
    ...state,
    turnPhase: "idle",
    settledTurnId: turnId ?? state.activeTurnId,
    backendSawTurnInFlight: false,
    stopPending: false,
  };
}
