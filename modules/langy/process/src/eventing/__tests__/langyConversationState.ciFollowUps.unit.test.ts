/**
 * The conversation's count of CI follow-ups in a row: messages CI started since the person last
 * wrote. The CI follow-up service reads it from the conversation row to stop at the cap.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
import type { StateProjectionStore } from "@langwatch/eventing";
import type { LangyConversationStateData } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { LangyConversationStateFoldProjection } from "../langy-conversation-state.projection.ts";
import { agentRespondedEvent, messageRecordedEvent, T0 } from "./langyEventFixtures.ts";

const noopStore: StateProjectionStore<LangyConversationStateData> = {
  store: async () => {},
  get: async () => ({ kind: "empty" as const }),
};

const projection = LangyConversationStateFoldProjection.create({ store: noopStore });

function personWrote(id: string) {
  return messageRecordedEvent({ id, occurredAt: T0 + 10, messageId: id });
}

function ciFollowUpRecorded(id: string) {
  const event = messageRecordedEvent({ id, occurredAt: T0 + 10, messageId: id });
  return {
    ...event,
    data: {
      ...event.data,
      ciFollowUp: { repositoryFullName: "acme/agent", prNumber: 12, headSha: "abc123" },
    },
  };
}

function fold(events: { type: string }[]): LangyConversationStateData {
  return events.reduce((state, event) => projection.apply(state, event), projection.init());
}

describe("the conversation's CI follow-ups in a row", () => {
  describe("given a conversation that opened a pull request", () => {
    /** @scenario "A follow-up message CI started counts one more in a row" */
    it("counts each follow-up message CI started", () => {
      const state = fold([
        personWrote("msg-person"),
        ciFollowUpRecorded("msg-ci-1"),
        ciFollowUpRecorded("msg-ci-2"),
      ]);

      expect(state.CiFollowUpsInARow).toBe(2);
    });

    /** @scenario "A message the person sends resets the count" */
    it("starts the count again when the person sends a message", () => {
      const state = fold([ciFollowUpRecorded("msg-ci-1"), personWrote("msg-person")]);

      expect(state.CiFollowUpsInARow).toBe(0);
    });

    /** @scenario "A follow-up turn completing does not reset the count" */
    it("keeps the count when the follow-up turn itself completes", () => {
      const state = fold([
        ciFollowUpRecorded("msg-ci-1"),
        agentRespondedEvent({ id: "evt-answer", occurredAt: T0 + 20, turnId: "turn-ci-1" }),
      ]);

      expect(state.CiFollowUpsInARow).toBe(1);
    });
  });

  describe("given a conversation folded before the count existed", () => {
    it("starts from zero", () => {
      expect(projection.init().CiFollowUpsInARow).toBe(0);
    });
  });
});
