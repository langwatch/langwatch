import { describe, expect, it } from "vitest";

import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_STATUS,
} from "../../constants";
import {
  foldLangyConversationState,
  initLangyConversationState,
  type LangyConversationStateEvent,
  type LangyConversationStateFoldState,
} from "./conversationFold";

const CONV = "conv-1";
const USER = "user-1";

function fold(
  events: LangyConversationStateEvent[],
  from: LangyConversationStateFoldState = initLangyConversationState(),
): LangyConversationStateFoldState {
  return events.reduce(foldLangyConversationState, from);
}

function started(occurredAt = 1_000): LangyConversationStateEvent {
  return {
    type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
    occurredAt,
    data: { conversationId: CONV, userId: USER, title: null },
  };
}

function turnAccepted(turnId: string, occurredAt: number): LangyConversationStateEvent {
  return {
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
    occurredAt,
    data: { conversationId: CONV, turnId },
  };
}

function responded(
  turnId: string,
  outcome: "completed" | "failed" | "stopped",
  occurredAt: number,
): LangyConversationStateEvent {
  return {
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
    occurredAt,
    data: {
      conversationId: CONV,
      turnId,
      messageId: `msg-${turnId}`,
      role: "assistant",
      parts: [{ type: "text", text: "an answer" }],
      outcome,
      error: outcome === "failed" ? "boom" : null,
    },
  };
}

describe("foldLangyConversationState", () => {
  describe("LastActivityAt", () => {
    // A late event carrying an earlier occurredAt must not move the timestamp
    // backwards: the liveness subscriber reads that as "gone quiet" and kills a
    // still-running turn.
    /** @scenario "The liveness timer stands down when the turn already completed" */
    it("never moves backwards when a late event carries an earlier occurredAt", () => {
      const state = fold([
        started(1_000),
        turnAccepted("turn-1", 5_000),
        // A straggler that is genuinely OLDER than what's already folded —
        // not a redelivery of the same event (that's the executor's job to
        // dedup), a DIFFERENT, late-arriving event.
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
          occurredAt: 2_000,
          data: {
            conversationId: CONV,
            turnId: "turn-1",
            toolCallId: "t-1",
            toolName: "bash",
          },
        },
      ]);
      expect(state.LastActivityAt).toBe(5_000);
    });

    it("still advances forward on a normally-ordered later event", () => {
      const state = fold([started(1_000), turnAccepted("turn-1", 5_000)]);
      expect(state.LastActivityAt).toBe(5_000);
    });
  });

  describe("AGENT_RESPONDED turn-identity guard", () => {
    // A late answer for turn N must not clear turn N+1's identity out from
    // under it.
    /** @scenario "The liveness timer stands down when a newer turn superseded the armed one" */
    it("does not clear a newer turn's CurrentTurnId when an older turn's answer lands late", () => {
      const state = fold([
        started(1_000),
        turnAccepted("turn-1", 2_000),
        turnAccepted("turn-2", 6_000), // turn-2 supersedes turn-1
        responded("turn-1", "completed", 9_000), // turn-1's answer arrives late
      ]);
      expect(state.CurrentTurnId).toBe("turn-2");
      expect(state.Status).toBe(LANGY_CONVERSATION_STATUS.RUNNING);
      expect(state.LastError).toBeNull();
    });

    it("still counts the late message and bumps activity", () => {
      const state = fold([
        started(1_000),
        turnAccepted("turn-1", 2_000),
        turnAccepted("turn-2", 6_000),
        responded("turn-1", "completed", 9_000),
      ]);
      expect(state.MessageCount).toBe(1);
      expect(state.LastActivityAt).toBe(9_000);
    });

    it("does transition status/current-turn when the response matches the current turn", () => {
      const state = fold([
        started(1_000),
        turnAccepted("turn-1", 2_000),
        responded("turn-1", "completed", 3_000),
      ]);
      expect(state.CurrentTurnId).toBeNull();
      expect(state.Status).toBe(LANGY_CONVERSATION_STATUS.IDLE);
    });

    it("marks the conversation FAILED only when the failing response matches the current turn", () => {
      const state = fold([
        started(1_000),
        turnAccepted("turn-1", 2_000),
        turnAccepted("turn-2", 6_000),
        responded("turn-1", "failed", 9_000),
      ]);
      // turn-1 no longer owns CurrentTurnId, so its failure must not paint
      // the conversation (currently running turn-2) as failed.
      expect(state.Status).toBe(LANGY_CONVERSATION_STATUS.RUNNING);
      expect(state.CurrentTurnId).toBe("turn-2");
    });
  });

  describe("order-invariance under best-effort delivery (ADR-098 decision 4)", () => {
    function permutations<T>(items: readonly T[]): T[][] {
      if (items.length <= 1) return [items.slice()];
      const [first, ...rest] = items;
      const restPerms = permutations(rest);
      const result: T[][] = [];
      for (const perm of restPerms) {
        for (let i = 0; i <= perm.length; i++) {
          result.push([...perm.slice(0, i), first as T, ...perm.slice(i)]);
        }
      }
      return result;
    }

    it("reaches the same LastActivityAt and MessageCount regardless of delivery order", () => {
      const events: LangyConversationStateEvent[] = [
        started(1_000),
        turnAccepted("turn-1", 2_000),
        responded("turn-1", "completed", 3_000),
      ];
      const results = permutations(events).map(
        (order) => fold(order).LastActivityAt,
      );
      expect(new Set(results).size).toBe(1);
      expect(results[0]).toBe(3_000);

      const counts = permutations(events).map((order) => fold(order).MessageCount);
      expect(new Set(counts)).toEqual(new Set([1]));
    });
  });
});
