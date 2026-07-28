import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { beforeEach, describe, expect, it } from "vitest";

import { useLangyStore } from "../langyStore";

/**
 * The store-level composition of the local turn projection with the turn-phase
 * machine (ADR-059): durable events drive the SAME machine the transport and
 * the fold-flag effect drive — a folded terminal settles it, a folded running
 * turn confirms it, and a snapshot naming an in-flight turn lets a refreshed
 * tab adopt it. The reducers themselves are package-tested; this file pins the
 * wiring.
 */

const accepted = (o: { id: string; createdAt: number; turnId?: string }) => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  data: { conversationId: "conv-1", turnId: o.turnId ?? "turn-1" },
});

const responded = (o: {
  id: string;
  createdAt: number;
  turnId?: string;
  outcome?: "completed" | "failed" | "stopped";
}) => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  data: {
    conversationId: "conv-1",
    turnId: o.turnId ?? "turn-1",
    messageId: "m1",
    role: "assistant" as const,
    parts: [],
    outcome: o.outcome ?? ("completed" as const),
  },
});

describe("the turn projection in the store", () => {
  beforeEach(() => {
    // Each test starts as a fresh page load: `scopeAnnounced` is never
    // persisted, and without clearing it a repeated same-scope reset is a
    // deliberate heartbeat no-op, leaking projection state between tests.
    useLangyStore.setState({ scopeAnnounced: false });
    useLangyStore.getState().resetForProject("project-test");
  });

  describe("when a snapshot names a turn in flight and this tab tracks none", () => {
    it("adopts the turn — Stop and live signals work after a refresh", () => {
      useLangyStore.getState().seedTurnProjection({
        cursor: { acceptedAt: 100, eventId: "e1" },
        currentTurnId: "turn-resumed",
      });
      const state = useLangyStore.getState();
      expect(state.activeTurnId).toBe("turn-resumed");
      expect(state.turnPhase).toBe("active");
      expect(state.turnProjection.cursor).toEqual({
        acceptedAt: 100,
        eventId: "e1",
      });
    });

    it("never clobbers a tab that is mid-send on its own turn", () => {
      useLangyStore
        .getState()
        .beginTurn({ conversationId: "conv-1", turnId: "turn-mine" });
      useLangyStore.getState().seedTurnProjection({
        cursor: { acceptedAt: 100, eventId: "e1" },
        currentTurnId: "turn-other",
      });
      expect(useLangyStore.getState().activeTurnId).toBe("turn-mine");
    });
  });

  describe("when the folded tail reaches a terminal", () => {
    it("settles the phase machine — recorded truth ends the turn", () => {
      useLangyStore
        .getState()
        .beginTurn({ conversationId: "conv-1", turnId: "turn-1" });
      useLangyStore
        .getState()
        .applyTurnEvents([
          accepted({ id: "e1", createdAt: 100 }),
          responded({ id: "e2", createdAt: 200, outcome: "stopped" }),
        ]);
      const state = useLangyStore.getState();
      expect(state.turnPhase).toBe("idle");
      expect(state.settledTurnId).toBe("turn-1");
      expect(state.turnProjection.turn?.Status).toBe("stopped");
    });
  });

  describe("when the folded tail shows a running turn this tab never started", () => {
    it("confirms the phase and adopts the turn id", () => {
      useLangyStore
        .getState()
        .applyTurnEvents([
          accepted({ id: "e1", createdAt: 100, turnId: "turn-foreign" }),
        ]);
      const state = useLangyStore.getState();
      expect(state.turnPhase).toBe("active");
      expect(state.activeTurnId).toBe("turn-foreign");
    });
  });

  describe("when a NEW foreign turn starts after this tab settled its own", () => {
    it("adopts it — the old settle marker gags only its own turn's re-assertion", () => {
      useLangyStore
        .getState()
        .beginTurn({ conversationId: "conv-1", turnId: "turn-1" });
      useLangyStore
        .getState()
        .applyTurnEvents([
          accepted({ id: "e1", createdAt: 100 }),
          responded({ id: "e2", createdAt: 200, outcome: "completed" }),
        ]);
      // Another tab (or a re-drive) starts a different turn afterwards.
      useLangyStore
        .getState()
        .applyTurnEvents([
          accepted({ id: "e3", createdAt: 300, turnId: "turn-foreign" }),
        ]);
      const state = useLangyStore.getState();
      expect(state.turnPhase).toBe("active");
      expect(state.activeTurnId).toBe("turn-foreign");
    });
  });

  describe("when a new chat starts", () => {
    it("drops the projection with the rest of the conversation state", () => {
      useLangyStore
        .getState()
        .applyTurnEvents([accepted({ id: "e1", createdAt: 100 })]);
      useLangyStore.getState().startNewConversation();
      expect(useLangyStore.getState().turnProjection).toEqual({
        cursor: null,
        turnId: null,
        turn: null,
      });
    });
  });
});
