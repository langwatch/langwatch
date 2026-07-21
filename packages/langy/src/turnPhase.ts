/**
 * The Langy turn phase state machine (ADR-058) — the whole thing, in one file.
 *
 * It is the SINGLE source for the composer's send/stop affordance and every
 * "is a turn in flight" read, replacing the old scatter of isBusy /
 * serverTurnInFlight / isStopping / settled-marker booleans that were derived
 * per-render across the panel.
 *
 *   idle ──beginTurn──▶ active ──requestStop──▶ stopping
 *     ▲                   │   ◀──abandonStop───    │
 *     └───────settleTurn / observeBackendTurn(false)┘
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
}

export const initialTurnPhaseState: TurnPhaseState = {
  turnPhase: "idle",
  activeTurnId: null,
  settledTurnId: null,
  backendSawTurnInFlight: false,
};

/**
 * A turn was dispatched (the transport adopted its ids): adopt it, go `active`,
 * and forget the previous turn's settle marker + fold confirmation.
 */
export function beginTurn(_state: TurnPhaseState, turnId: string): TurnPhaseState {
  return {
    turnPhase: "active",
    activeTurnId: turnId,
    settledTurnId: null,
    backendSawTurnInFlight: false,
  };
}

/** The user hit Stop: `active` → `stopping` (a no-op in any other phase). */
export function requestStop(state: TurnPhaseState): TurnPhaseState {
  return state.turnPhase === "active"
    ? { ...state, turnPhase: "stopping" }
    : state;
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
    ? { ...state, turnPhase: "active" }
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
  return { ...state, turnPhase: "idle", backendSawTurnInFlight: false };
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
  };
}
