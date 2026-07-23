import { describe, expect, it } from "vitest";

import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_TURN_STATUS,
  LANGY_TURN_TOOL_CALL_STATUS,
} from "../../constants";
import {
  foldLangyConversationTurn,
  initLangyConversationTurnState,
  makeConversationTurnKey,
  parseConversationTurnKey,
  type LangyConversationTurnEvent,
  type LangyConversationTurnFoldState,
} from "./turnFold";

const IDS = { conversationId: "conv-1", turnId: "turn-1" };

function fold(
  events: LangyConversationTurnEvent[],
  from: LangyConversationTurnFoldState = initLangyConversationTurnState(),
): LangyConversationTurnFoldState {
  return events.reduce(foldLangyConversationTurn, from);
}

function accepted(at = 1_000): LangyConversationTurnEvent {
  return {
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
    occurredAt: at,
    data: { ...IDS, questionParts: [{ type: "text", text: "why?" }] },
  };
}

function responded(
  outcome: "completed" | "failed" | "stopped",
  at = 5_000,
): LangyConversationTurnEvent {
  return {
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
    occurredAt: at,
    data: {
      ...IDS,
      messageId: "msg-1",
      role: "assistant",
      parts: [{ type: "text", text: "because." }],
      outcome,
      error: outcome === "failed" ? "model refused" : null,
    },
  };
}

describe("foldLangyConversationTurn", () => {
  describe("given a clean accept → respond lifecycle", () => {
    it("folds one self-contained turn document", () => {
      const state = fold([accepted(), responded("completed")]);

      expect(state.ConversationId).toBe("conv-1");
      expect(state.TurnId).toBe("turn-1");
      expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.COMPLETED);
      expect(state.QuestionParts).toEqual([{ type: "text", text: "why?" }]);
      expect(state.AnswerParts).toEqual([{ type: "text", text: "because." }]);
      expect(state.StartedAt).toBe(1_000);
      expect(state.EndedAt).toBe(5_000);
      expect(state.Error).toBeNull();
    });

    it("never mutates the input state — the fold is pure", () => {
      const before = initLangyConversationTurnState();
      const snapshot = structuredClone(before);
      fold([accepted(), responded("completed")], before);
      expect(before).toEqual(snapshot);
    });
  });

  describe("when the user stops the turn mid-answer (ADR-058)", () => {
    it("keeps the partial answer, reads stopped, and carries no error", () => {
      const state = fold([accepted(), responded("stopped")]);
      expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.STOPPED);
      expect(state.AnswerParts.length).toBeGreaterThan(0);
      expect(state.Error).toBeNull();
    });
  });

  describe("when the answer-carrying terminal reports failure", () => {
    it("reads failed and keeps the failure text", () => {
      const state = fold([accepted(), responded("failed")]);
      expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.FAILED);
      expect(state.Error).toBe("model refused");
    });
  });

  describe("when the no-answer stall terminalizes the turn", () => {
    it("reads failed with the stall error and no answer", () => {
      const state = fold([
        accepted(),
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
          occurredAt: 9_000,
          data: { ...IDS, error: "worker went silent" },
        },
      ]);
      expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.FAILED);
      expect(state.Error).toBe("worker went silent");
      expect(state.AnswerParts).toEqual([]);
      expect(state.EndedAt).toBe(9_000);
    });
  });

  describe("given tool call lifecycle events", () => {
    it("initiates then resolves in place, keeping initiation order", () => {
      const state = fold([
        accepted(),
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
          occurredAt: 2_000,
          data: { ...IDS, toolCallId: "t-1", toolName: "bash", command: "ls" },
        },
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
          occurredAt: 2_100,
          data: { ...IDS, toolCallId: "t-2", toolName: "webfetch" },
        },
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
          occurredAt: 2_500,
          data: {
            ...IDS,
            toolCallId: "t-1",
            toolName: "bash",
            durationMs: 500,
          },
        },
      ]);

      expect(state.ToolCalls.map((t) => t.toolCallId)).toEqual(["t-1", "t-2"]);
      expect(state.ToolCalls[0]).toMatchObject({
        status: LANGY_TURN_TOOL_CALL_STATUS.SUCCEEDED,
        command: "ls",
        durationMs: 500,
      });
      expect(state.ToolCalls[1]?.status).toBe(
        LANGY_TURN_TOOL_CALL_STATUS.INITIATED,
      );
    });

    it("lands a terminal whose initiated frame never arrived (defensive upsert)", () => {
      const state = fold([
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
          occurredAt: 3_000,
          data: {
            ...IDS,
            toolCallId: "t-lost",
            toolName: "bash",
            errorText: "exit 1",
          },
        },
      ]);
      expect(state.ToolCalls).toHaveLength(1);
      expect(state.ToolCalls[0]).toMatchObject({
        toolCallId: "t-lost",
        status: LANGY_TURN_TOOL_CALL_STATUS.FAILED,
        errorText: "exit 1",
      });
      // Identity hydrates from ANY turn event — a mid-stream fold still knows
      // which turn it is.
      expect(state.TurnId).toBe("turn-1");
    });
  });

  describe("given repeated plan snapshots", () => {
    it("keeps the whole latest list — last write wins", () => {
      const state = fold([
        accepted(),
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
          occurredAt: 2_000,
          data: { ...IDS, items: [{ content: "a", status: "pending" }] },
        },
        {
          type: LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
          occurredAt: 3_000,
          data: {
            ...IDS,
            items: [
              { content: "a", status: "completed" },
              { content: "b", status: "in_progress" },
            ],
          },
        },
      ]);
      expect(state.Plan).toEqual([
        { content: "a", status: "completed" },
        { content: "b", status: "in_progress" },
      ]);
      expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.RUNNING);
    });
  });

  describe("when the same terminal is folded twice (at-least-once delivery)", () => {
    it("is idempotent — the second application changes nothing", () => {
      const once = fold([accepted(), responded("completed")]);
      const twice = fold([responded("completed")], once);
      expect(twice).toEqual(once);
    });
  });
});

describe("conversation turn keys", () => {
  it("round-trips (conversationId, turnId) through the composite key", () => {
    const key = makeConversationTurnKey("conv-1", "turn-1");
    expect(parseConversationTurnKey(key)).toEqual({
      conversationId: "conv-1",
      turnId: "turn-1",
    });
  });
});
