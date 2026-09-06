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

const CONVERSATION_ID = "conv-1";

function fold(
  events: LangyConversationStateEvent[],
): LangyConversationStateFoldState {
  return events.reduce(foldLangyConversationState, initLangyConversationState());
}

function accepted({
  turnId,
  model,
  at = 1_000,
}: {
  turnId: string;
  model?: string;
  at?: number;
}): LangyConversationStateEvent {
  return {
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
    occurredAt: at,
    data: {
      conversationId: CONVERSATION_ID,
      turnId,
      ...(model ? { model } : {}),
    },
  };
}

function responded({
  turnId,
  at = 2_000,
}: {
  turnId: string;
  at?: number;
}): LangyConversationStateEvent {
  return {
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
    occurredAt: at,
    data: {
      conversationId: CONVERSATION_ID,
      turnId,
      messageId: `msg-${turnId}`,
      role: "assistant",
      parts: [],
      outcome: "completed",
    },
  };
}

function recorded({
  role,
  text,
  at = 3_000,
}: {
  role: "user" | "system";
  text: string;
  at?: number;
}): LangyConversationStateEvent {
  return {
    type: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
    occurredAt: at,
    data: {
      conversationId: CONVERSATION_ID,
      userId: "user-1",
      messageId: `msg-${at}`,
      role,
      parts: [{ type: "text", text }],
    },
  };
}

describe("foldLangyConversationState", () => {
  describe("when a turn is accepted carrying its model", () => {
    /** @scenario Reopening a conversation restores the model it last ran on */
    it("remembers the model as the conversation's last model", () => {
      const state = fold([
        accepted({ turnId: "t1", model: "openai/gpt-5-mini" }),
      ]);

      expect(state.LastModel).toBe("openai/gpt-5-mini");
    });

    it("keeps the newest model when turns switch models", () => {
      const state = fold([
        accepted({ turnId: "t1", model: "openai/gpt-5-mini", at: 1_000 }),
        accepted({ turnId: "t2", model: "custom/stealth/ox-alpha", at: 2_000 }),
      ]);

      expect(state.LastModel).toBe("custom/stealth/ox-alpha");
    });
  });

  describe("when an accepted turn carries no model", () => {
    it("keeps the model an earlier turn recorded", () => {
      const state = fold([
        accepted({ turnId: "t1", model: "openai/gpt-5-mini", at: 1_000 }),
        accepted({ turnId: "t2", at: 2_000 }),
      ]);

      expect(state.LastModel).toBe("openai/gpt-5-mini");
    });

    it("stays null for a conversation that never recorded one", () => {
      const state = fold([accepted({ turnId: "t1" })]);

      expect(state.LastModel).toBeNull();
    });
  });

  describe("when a message is recorded", () => {
    describe("when it comes from the developer", () => {
      it("opens the conversation for the turn that answers it", () => {
        const state = fold([
          accepted({ turnId: "t1" }),
          responded({ turnId: "t1", at: 2_000 }),
          recorded({ role: "user", text: "Add a health endpoint", at: 3_000 }),
        ]);

        expect(state.Status).toBe(LANGY_CONVERSATION_STATUS.ACTIVE);
      });
    });

    describe("when it is a notice rather than something the developer sent", () => {
      /** @scenario "The disconnect notice does not put the conversation back to work" */
      it("leaves a settled conversation idle", () => {
        const state = fold([
          accepted({ turnId: "t1" }),
          responded({ turnId: "t1", at: 2_000 }),
          recorded({
            role: "system",
            text: "Local folder disconnected: acme-app on rogerio-mbp",
            at: 3_000,
          }),
        ]);

        expect(state.Status).toBe(LANGY_CONVERSATION_STATUS.IDLE);
      });

      it("leaves a running turn running", () => {
        const state = fold([
          accepted({ turnId: "t1" }),
          recorded({
            role: "system",
            text: "Local folder disconnected: acme-app on rogerio-mbp",
            at: 2_000,
          }),
        ]);

        expect(state.Status).toBe(LANGY_CONVERSATION_STATUS.RUNNING);
        expect(state.CurrentTurnId).toBe("t1");
      });

      it("still counts as a message on the conversation", () => {
        const state = fold([
          recorded({
            role: "system",
            text: "Local folder disconnected: acme-app on rogerio-mbp",
          }),
        ]);

        expect(state.MessageCount).toBe(1);
      });
    });
  });
});
