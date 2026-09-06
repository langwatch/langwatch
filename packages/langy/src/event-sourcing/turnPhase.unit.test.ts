import { describe, expect, it } from "vitest";
import {
  abandonSend,
  abandonStop,
  beginSend,
  beginTurn,
  initialTurnPhaseState,
  observeBackendTurn,
  requestStop,
  settleTurn,
  stopDispatched,
  type TurnPhaseState,
} from "./turnPhase";

const active = (turnId = "t1"): TurnPhaseState =>
  beginTurn(initialTurnPhaseState, turnId);

describe("langyTurnPhase machine", () => {
  describe("given the idle initial state", () => {
    it("is idle with no turn", () => {
      expect(initialTurnPhaseState.turnPhase).toBe("idle");
      expect(initialTurnPhaseState.activeTurnId).toBeNull();
    });
  });

  describe("when a turn is dispatched", () => {
    it("goes active and adopts the turn, dropping any prior settle/confirmation", () => {
      const settledPrior: TurnPhaseState = {
        turnPhase: "idle",
        activeTurnId: "old",
        settledTurnId: "old",
        backendSawTurnInFlight: true,
        stopPending: false,
      };
      const state = beginTurn(settledPrior, "t2");
      expect(state.turnPhase).toBe("active");
      expect(state.activeTurnId).toBe("t2");
      expect(state.settledTurnId).toBeNull();
      expect(state.backendSawTurnInFlight).toBe(false);
    });
  });

  describe("when the user sends a message", () => {
    /** @scenario Stop is available the moment I send */
    it("goes active before any turn id exists, so Stop is available at once", () => {
      const state = beginSend(initialTurnPhaseState);
      expect(state.turnPhase).toBe("active");
      expect(state.activeTurnId).toBeNull();
      expect(state.stopPending).toBe(false);
    });
  });

  describe("given the user stopped a send that has no turn id yet", () => {
    const pending = requestStop(beginSend(initialTurnPhaseState), {
      dispatched: false,
    });

    /** @scenario Stop during startup is kept and dispatched when the turn is identified */
    it("shows it is stopping and remembers the stop", () => {
      expect(pending.turnPhase).toBe("stopping");
      expect(pending.stopPending).toBe(true);
    });

    describe("when the turn is identified", () => {
      /** @scenario Stop during startup is kept and dispatched when the turn is identified */
      it("keeps the stopping phase and exposes the turn to dispatch against", () => {
        const identified = beginTurn(pending, "t9");
        expect(identified.turnPhase).toBe("stopping");
        expect(identified.activeTurnId).toBe("t9");
        expect(identified.stopPending).toBe(true);
        const sent = stopDispatched(identified);
        expect(sent.turnPhase).toBe("stopping");
        expect(sent.stopPending).toBe(false);
      });
    });

    describe("when the send fails before any turn id exists", () => {
      /** @scenario A send that fails before the turn is identified hands the control back */
      it("returns to idle and drops the stop, since there is nothing to stop", () => {
        const state = abandonSend(pending);
        expect(state.turnPhase).toBe("idle");
        expect(state.stopPending).toBe(false);
      });
    });

    describe("when the turn is already identified", () => {
      it("leaves a failure to the turn's own terminal", () => {
        expect(abandonSend(active("t3")).turnPhase).toBe("active");
        expect(abandonSend(initialTurnPhaseState).turnPhase).toBe("idle");
      });
    });
  });

  describe("when the user requests a stop", () => {
    it("moves active → stopping", () => {
      expect(requestStop(active()).turnPhase).toBe("stopping");
    });

    it("remembers nothing when the caller dispatched the stop itself", () => {
      expect(requestStop(active()).stopPending).toBe(false);
    });

    it("is a no-op when not active", () => {
      expect(requestStop(initialTurnPhaseState).turnPhase).toBe("idle");
      const stopping = requestStop(active());
      expect(requestStop(stopping).turnPhase).toBe("stopping");
    });
  });

  describe("when the stop request never reached the backend", () => {
    it("returns stopping → active, keeping the turn it was tracking", () => {
      const abandoned = abandonStop(requestStop(active("t7")));
      expect(abandoned.turnPhase).toBe("active");
      expect(abandoned.activeTurnId).toBe("t7");
    });

    it("leaves a phase that was never stopping alone", () => {
      expect(abandonStop(active()).turnPhase).toBe("active");
      expect(abandonStop(initialTurnPhaseState).turnPhase).toBe("idle");
    });
  });

  describe("when the durable fold is observed", () => {
    it("ignores a bare not-in-flight right after a send (projection lag) — stays active", () => {
      // The fold has not yet caught up to the send: backendSaw is false, so a
      // false must NOT flicker active→idle.
      const state = observeBackendTurn(active(), false);
      expect(state.turnPhase).toBe("active");
    });

    it("settles active → idle once a CONFIRMED turn goes idle", () => {
      let state = observeBackendTurn(active(), true); // fold confirms in flight
      expect(state.turnPhase).toBe("active");
      expect(state.backendSawTurnInFlight).toBe(true);
      state = observeBackendTurn(state, false); // and then goes idle
      expect(state.turnPhase).toBe("idle");
    });

    it("adopts a turn this tab did not start (idle → active)", () => {
      const state = observeBackendTurn(initialTurnPhaseState, true);
      expect(state.turnPhase).toBe("active");
    });

    /** @scenario Stop shows it is stopping until the backend confirms */
    it("keeps the stopping phase while the fold still reports the turn", () => {
      const stopping = requestStop(active());
      expect(observeBackendTurn(stopping, true).turnPhase).toBe("stopping");
    });

    it("does not re-assert a turn the stream already settled", () => {
      const settled = settleTurn(active("t1"), "t1"); // stream end → idle
      const state = observeBackendTurn(settled, true); // fold lags, still true
      expect(state.turnPhase).toBe("idle");
    });
  });

  describe("when a genuine end-of-turn frame settles the turn", () => {
    it("goes idle immediately and records the settled turn", () => {
      const state = settleTurn(active("t1"), "t1");
      expect(state.turnPhase).toBe("idle");
      expect(state.settledTurnId).toBe("t1");
      expect(state.stopPending).toBe(false);
    });

    it("ignores a stale end frame for a superseded turn", () => {
      const state = settleTurn(active("t2"), "t1"); // t1 is old, t2 is live
      expect(state.turnPhase).toBe("active");
    });
  });
});
