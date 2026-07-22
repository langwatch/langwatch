import { describe, expect, it } from "vitest";

import { LANGY_CONVERSATION_EVENT_TYPES } from "../constants";
import type { LangyConversationTurnWireEvent } from "./contracts/turnWire";
import {
  applyLangyTurnEvents,
  initialLangyTurnProjection,
  isLangyTurnProjectionTerminal,
  seedLangyTurnProjection,
} from "./turnProjection";

const accepted = (o: {
  id: string;
  createdAt: number;
  turnId?: string;
}): LangyConversationTurnWireEvent => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  data: { conversationId: "c1", turnId: o.turnId ?? "t1" },
});

const responded = (o: {
  id: string;
  createdAt: number;
  turnId?: string;
  outcome?: "completed" | "failed" | "stopped";
}): LangyConversationTurnWireEvent => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  data: {
    conversationId: "c1",
    turnId: o.turnId ?? "t1",
    messageId: "m1",
    role: "assistant",
    parts: [{ type: "text", text: "done" }],
    outcome: o.outcome ?? "completed",
  },
});

describe("the local turn projection", () => {
  describe("given a snapshot seed", () => {
    it("adopts the cursor and the in-flight turn id, with no document yet", () => {
      const state = seedLangyTurnProjection(initialLangyTurnProjection, {
        cursor: { acceptedAt: 100, eventId: "e1" },
        currentTurnId: "t1",
      });
      expect(state).toEqual({
        cursor: { acceptedAt: 100, eventId: "e1" },
        turnId: "t1",
        turn: null,
      });
    });

    it("never rewinds a fresher local fold to an older re-fetched snapshot", () => {
      // The live tail beat the query: the local fold is at 200, the snapshot
      // that just landed was taken at 100. Re-seeding would drop the folded
      // document and replay-flicker the turn — it must be a no-op.
      const ahead = applyLangyTurnEvents(initialLangyTurnProjection, [
        accepted({ id: "e1", createdAt: 100 }),
        responded({ id: "e2", createdAt: 200 }),
      ]);
      const reseeded = seedLangyTurnProjection(ahead, {
        cursor: { acceptedAt: 100, eventId: "e1" },
        currentTurnId: null,
      });
      expect(reseeded).toBe(ahead);
    });
  });

  describe("when a tail folds after the snapshot", () => {
    it("folds only events after the cursor and advances it", () => {
      const seeded = seedLangyTurnProjection(initialLangyTurnProjection, {
        cursor: { acceptedAt: 100, eventId: "e1" },
      });
      const state = applyLangyTurnEvents(seeded, [
        // At the cursor — already folded into the snapshot; must be dropped.
        accepted({ id: "e1", createdAt: 100 }),
        responded({ id: "e2", createdAt: 200 }),
      ]);
      expect(state.cursor).toEqual({ acceptedAt: 200, eventId: "e2" });
      expect(state.turn?.Status).toBe("completed");
      expect(isLangyTurnProjectionTerminal(state)).toBe(true);
    });

    /** @scenario Applying a recorded step the view has already seen changes nothing */
    it("re-applying the same tail changes nothing — replay is safe", () => {
      const tail = [
        accepted({ id: "e1", createdAt: 100 }),
        responded({ id: "e2", createdAt: 200 }),
      ];
      const once = applyLangyTurnEvents(initialLangyTurnProjection, tail);
      const twice = applyLangyTurnEvents(once, tail);
      expect(twice).toEqual(once);
    });

    it("overlapping fetches fold each event exactly once", () => {
      const e1 = accepted({ id: "e1", createdAt: 100 });
      const e2 = responded({ id: "e2", createdAt: 200 });
      const viaOverlap = applyLangyTurnEvents(
        applyLangyTurnEvents(initialLangyTurnProjection, [e1]),
        [e1, e2],
      );
      const straight = applyLangyTurnEvents(initialLangyTurnProjection, [
        e1,
        e2,
      ]);
      expect(viaOverlap).toEqual(straight);
    });
  });

  describe("when a new turn starts", () => {
    it("replaces the document — past turns live in message history", () => {
      const first = applyLangyTurnEvents(initialLangyTurnProjection, [
        accepted({ id: "e1", createdAt: 100, turnId: "t1" }),
        responded({ id: "e2", createdAt: 200, turnId: "t1" }),
      ]);
      const second = applyLangyTurnEvents(first, [
        accepted({ id: "e3", createdAt: 300, turnId: "t2" }),
      ]);
      expect(second.turnId).toBe("t2");
      expect(second.turn?.Status).toBe("running");
      expect(isLangyTurnProjectionTerminal(second)).toBe(false);
    });
  });

  describe("terminal detection", () => {
    it("treats stopped as terminal — a stop settles the turn (ADR-058)", () => {
      const state = applyLangyTurnEvents(initialLangyTurnProjection, [
        responded({ id: "e1", createdAt: 100, outcome: "stopped" }),
      ]);
      expect(state.turn?.Status).toBe("stopped");
      expect(isLangyTurnProjectionTerminal(state)).toBe(true);
    });
  });
});
