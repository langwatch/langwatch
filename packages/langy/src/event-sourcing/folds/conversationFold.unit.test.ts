import { describe, expect, it } from "vitest";

import { LANGY_CONVERSATION_EVENT_TYPES } from "../../constants";
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
});
