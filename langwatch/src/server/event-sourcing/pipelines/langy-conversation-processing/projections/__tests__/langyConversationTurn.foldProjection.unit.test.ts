import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import type { StateProjectionStore } from "../../../../projections/stateProjection.types";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  LANGY_CONVERSATION_TURN_STATUS,
  LANGY_TURN_TOOL_CALL_STATUS,
} from "../../schemas/constants";
import type { LangyConversationProcessingEvent } from "../../schemas/events";
import {
  LangyConversationTurnFoldProjection,
  type LangyConversationTurnData,
  makeConversationTurnKey,
  parseConversationTurnKey,
} from "../langyConversationTurn.foldProjection";

const noopStore: StateProjectionStore<LangyConversationTurnData> = {
  store: async () => {},
  load: async () => null,
};

const fold = new LangyConversationTurnFoldProjection({ store: noopStore });

const TENANT = createTenantId("project-1");
const CONVERSATION = "conv-1";
const TURN = "turn-1";

function event(
  typeKey: keyof typeof LANGY_CONVERSATION_EVENT_TYPES,
  version: string,
  data: Record<string, unknown>,
  occurredAt: number,
): LangyConversationProcessingEvent {
  return {
    id: `event-${occurredAt}`,
    aggregateId: CONVERSATION,
    aggregateType: "langy_conversation",
    tenantId: TENANT,
    createdAt: occurredAt,
    occurredAt,
    type: LANGY_CONVERSATION_EVENT_TYPES[typeKey],
    version,
    data: { conversationId: CONVERSATION, turnId: TURN, ...data },
  } as unknown as LangyConversationProcessingEvent;
}

const started = (occurredAt: number) =>
  event(
    "AGENT_TURN_ACCEPTED",
    LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED,
    {},
    occurredAt,
  );

const toolInitiated = (
  data: Record<string, unknown>,
  occurredAt: number,
): LangyConversationProcessingEvent =>
  event(
    "TOOL_CALL_INITIATED",
    LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_INITIATED,
    { toolCallId: "tc-1", toolName: "bash", ...data },
    occurredAt,
  );

describe("LangyConversationTurnFoldProjection", () => {
  describe("the composite key", () => {
    it("makes and parses a conversationId:turnId key round-trip", () => {
      const key = makeConversationTurnKey(CONVERSATION, TURN);
      expect(key).toBe("conv-1:turn-1");
      expect(parseConversationTurnKey(key)).toEqual({
        conversationId: CONVERSATION,
        turnId: TURN,
      });
    });

    it("keys the fold document by conversationId and turnId", () => {
      expect(fold.key(started(1000))).toBe("conv-1:turn-1");
    });
  });

  describe("given an agent response begins", () => {
    it("marks the turn running and records identity and start time", () => {
      const state = fold.apply(fold.init(), started(1000));

      expect(state.ConversationId).toBe(CONVERSATION);
      expect(state.TurnId).toBe(TURN);
      expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.RUNNING);
      expect(state.StartedAt).toBe(1000);
      expect(state.ToolCalls).toEqual([]);
    });

    it("folds the question parts into the turn document when carried", () => {
      const state = fold.apply(
        fold.init(),
        event(
          "AGENT_TURN_ACCEPTED",
          LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED,
          { questionParts: [{ type: "text", text: "why failing?" }] },
          1000,
        ),
      );
      expect(state.QuestionParts).toEqual([
        { type: "text", text: "why failing?" },
      ]);
    });
  });

  describe("given a tool call runs during the turn", () => {
    const running = fold.apply(fold.init(), started(1000));

    describe("when it is initiated then succeeds", () => {
      it("accretes one tool call and resolves it to succeeded", () => {
        const initiated = fold.apply(
          running,
          toolInitiated(
            { command: "grep traces", input: { q: "traces" } },
            1100,
          ),
        );
        expect(initiated.ToolCalls).toHaveLength(1);
        expect(initiated.ToolCalls[0]).toMatchObject({
          toolCallId: "tc-1",
          toolName: "bash",
          command: "grep traces",
          status: LANGY_TURN_TOOL_CALL_STATUS.INITIATED,
        });

        const succeeded = fold.apply(
          initiated,
          event(
            "TOOL_CALL_SUCCEEDED",
            LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED,
            { toolCallId: "tc-1", toolName: "bash", durationMs: 42 },
            1200,
          ),
        );
        expect(succeeded.ToolCalls).toHaveLength(1);
        expect(succeeded.ToolCalls[0]).toMatchObject({
          toolCallId: "tc-1",
          status: LANGY_TURN_TOOL_CALL_STATUS.SUCCEEDED,
          durationMs: 42,
          command: "grep traces",
        });
      });
    });

    describe("when it fails", () => {
      it("resolves the call to failed carrying the error text", () => {
        const initiated = fold.apply(running, toolInitiated({}, 1100));
        const failed = fold.apply(
          initiated,
          event(
            "TOOL_CALL_FAILED",
            LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_FAILED,
            { toolCallId: "tc-1", toolName: "bash", errorText: "boom" },
            1200,
          ),
        );
        expect(failed.ToolCalls[0]).toMatchObject({
          status: LANGY_TURN_TOOL_CALL_STATUS.FAILED,
          errorText: "boom",
        });
      });
    });

    describe("when a terminal arrives before its initiate (out of order)", () => {
      it("still records the tool call", () => {
        const succeeded = fold.apply(
          running,
          event(
            "TOOL_CALL_SUCCEEDED",
            LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED,
            { toolCallId: "tc-9", toolName: "read", durationMs: 5 },
            1200,
          ),
        );
        expect(succeeded.ToolCalls).toHaveLength(1);
        expect(succeeded.ToolCalls[0]).toMatchObject({
          toolCallId: "tc-9",
          status: LANGY_TURN_TOOL_CALL_STATUS.SUCCEEDED,
        });
      });
    });
  });

  describe("given the response reaches a terminal", () => {
    const running = fold.apply(fold.init(), started(1000));

    describe("when the agent responds with a completed answer", () => {
      it("stores the answer parts and marks the turn completed", () => {
        const state = fold.apply(
          running,
          event(
            "AGENT_RESPONDED",
            LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED,
            {
              messageId: "a1",
              role: "assistant",
              parts: [{ type: "text", text: "here is why" }],
              outcome: "completed",
            },
            2000,
          ),
        );
        expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.COMPLETED);
        expect(state.AnswerParts).toEqual([
          { type: "text", text: "here is why" },
        ]);
        expect(state.EndedAt).toBe(2000);
        expect(state.Error).toBeNull();
      });
    });

    describe("when the agent responds with a failed outcome", () => {
      it("marks the turn failed and carries the error", () => {
        const state = fold.apply(
          running,
          event(
            "AGENT_RESPONDED",
            LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED,
            {
              messageId: "a1",
              role: "assistant",
              parts: [],
              outcome: "failed",
              error: "model timeout",
            },
            2000,
          ),
        );
        expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.FAILED);
        expect(state.Error).toBe("model timeout");
      });
    });

    describe("when the response fails with no answer to carry", () => {
      it("marks the turn failed with the error and no answer parts", () => {
        const state = fold.apply(
          running,
          event(
            "AGENT_RESPONSE_FAILED",
            LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONSE_FAILED,
            { error: "turn stalled" },
            2000,
          ),
        );
        expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.FAILED);
        expect(state.Error).toBe("turn stalled");
        expect(state.AnswerParts).toEqual([]);
        expect(state.EndedAt).toBe(2000);
      });
    });
  });

  describe("given the agent updates its plan", () => {
    const planUpdated = (
      items: Array<{ content: string; status: string }>,
      occurredAt: number,
    ) =>
      event(
        "PLAN_UPDATED",
        LANGY_CONVERSATION_EVENT_VERSIONS.PLAN_UPDATED,
        { items },
        occurredAt,
      );

    it("starts with no plan", () => {
      expect(fold.init().Plan).toBeNull();
    });

    it("folds the plan snapshot onto the turn without changing its status", () => {
      let state = fold.apply(fold.init(), started(1000));
      state = fold.apply(
        state,
        planUpdated(
          [
            { content: "Find the slow traces", status: "in_progress" },
            { content: "Summarise them", status: "pending" },
          ],
          1100,
        ),
      );
      expect(state.Plan).toEqual([
        { content: "Find the slow traces", status: "in_progress" },
        { content: "Summarise them", status: "pending" },
      ]);
      // A plan can arrive mid-turn; it must not regress the running status.
      expect(state.Status).toBe(LANGY_CONVERSATION_TURN_STATUS.RUNNING);
    });

    it("keeps the LATEST snapshot when the plan is rewritten (last-write-wins)", () => {
      let state = fold.apply(fold.init(), started(1000));
      state = fold.apply(
        state,
        planUpdated([{ content: "Step one", status: "in_progress" }], 1100),
      );
      state = fold.apply(
        state,
        planUpdated(
          [
            { content: "Step one", status: "completed" },
            { content: "Step two", status: "in_progress" },
          ],
          1200,
        ),
      );
      expect(state.Plan).toEqual([
        { content: "Step one", status: "completed" },
        { content: "Step two", status: "in_progress" },
      ]);
    });
  });
});
