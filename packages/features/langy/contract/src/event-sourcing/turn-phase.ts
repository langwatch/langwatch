/**
 * The Langy turn phase state machine (ADR-078): idle -> active -> stopping.
 * Single source for send/stop affordance; pure transitions, no Zustand/React.
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
  /** A Stop asked for before any turn id existed; dispatched once one does (`stopDispatched`). */
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
 * The user sent a message: go `active` immediately, no turn id yet. Waiting
 * for the ids left the composer showing Send for up to 12s on a cold worker.
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
 * A turn was dispatched: adopt its id, go `active`, forget the previous
 * turn's settle marker. A stop asked for during the send survives (`stopping`
 * + pending), dispatched against the id this transition just supplied.
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
 * The user hit Stop: `active` → `stopping` (no-op elsewhere). `dispatched:
 * false` means no turn id existed yet, so the intent is remembered.
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
 * Whether this tab is waiting on ids for a message it just sent — distinct
 * from a turn adopted from the durable record, see `resolveLangyStopTarget`.
 */
export function isSendUnanswered(state: TurnPhaseState): boolean {
  return state.turnPhase !== "idle" && state.activeTurnId === null && !state.backendSawTurnInFlight;
}

/** The pending stop went out: the phase stays `stopping`, nothing is owed. */
export function stopDispatched(state: TurnPhaseState): TurnPhaseState {
  return state.stopPending ? { ...state, stopPending: false } : state;
}

/**
 * The send failed before any turn id existed: back to `idle`, dropping any
 * pending stop. No-op once an id is known — that failure is the turn's own
 * terminal to tell.
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
 * The stop request never reached the backend: `stopping` → `active`, since
 * `stopping` is a promise that only survives a request that actually went out.
 */
export function abandonStop(state: TurnPhaseState): TurnPhaseState {
  return state.turnPhase === "stopping"
    ? { ...state, turnPhase: "active", stopPending: false }
    : state;
}

/**
 * The durable fold reported whether a turn is in flight — tab-independent
 * truth. Feeds `active` for a turn this tab didn't start, settles to `idle`
 * once the fold that CONFIRMED the turn goes idle.
 */
export function observeBackendTurn(state: TurnPhaseState, inFlight: boolean): TurnPhaseState {
  const alreadySettled = state.activeTurnId !== null && state.settledTurnId === state.activeTurnId;
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
export function settleTurn(state: TurnPhaseState, turnId: string | null): TurnPhaseState {
  // A stale end frame for a superseded turn does not settle the new one.
  if (turnId !== null && state.activeTurnId !== null && turnId !== state.activeTurnId) {
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
