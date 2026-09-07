import { beforeEach, describe, expect, it } from "vitest";
import type { GuidedKickoffInput } from "~/features/guided-onboarding/kickoff";
import { useLangyStore } from "../stores/langyStore";

/**
 * The tour hands the guided onboarding to the panel through the store:
 * `queueGuidedKickoff` opens the panel, points it at the organization's
 * conversation (or at none) and queues the kickoff; the panel drains it and
 * calls `consumePendingKickoff` so it sends exactly once.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
const KICKOFF: GuidedKickoffInput = {
  path: "llmops",
  paths: ["llmops"],
  provider: "OpenAI",
  providerModel: "gpt-5",
  orgName: "ACME",
  firstName: "Ada",
  tourStatus: "completed",
};

describe("queueGuidedKickoff", () => {
  beforeEach(() => {
    useLangyStore.getState().resetForProject("project-test");
    useLangyStore.getState().closePanel();
    useLangyStore.getState().setDraft("half a thought");
  });

  describe("given the tour ended with no attached conversation", () => {
    /** @scenario "Queuing the kickoff opens the panel on the path's conversation" */
    it("opens the panel and queues the kickoff with everything the takeover collected", () => {
      useLangyStore.getState().queueGuidedKickoff(KICKOFF);
      const state = useLangyStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.pendingKickoff).toEqual(KICKOFF);
    });

    /** @scenario "A queued kickoff with no attached conversation starts a fresh one" */
    it("points at no conversation and drops the old draft", () => {
      useLangyStore.getState().selectConversation("conv-old");
      useLangyStore.getState().queueGuidedKickoff(KICKOFF);
      const state = useLangyStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(state.historyLoadConversationId).toBeNull();
      expect(state.draft).toBe("");
      expect(state.pendingKickoff?.conversationId).toBeUndefined();
    });
  });

  describe("given the organization already attached a conversation", () => {
    /** @scenario "A queued kickoff for an attached conversation continues that conversation" */
    it("points at that conversation and loads its history before the kickoff sends", () => {
      useLangyStore.getState().queueGuidedKickoff({
        ...KICKOFF,
        path: "gateway",
        conversationId: "conv-attached",
      });
      const state = useLangyStore.getState();
      expect(state.activeConversationId).toBe("conv-attached");
      expect(state.historyLoadConversationId).toBe("conv-attached");
      expect(state.pendingKickoff?.conversationId).toBe("conv-attached");
    });
  });

  describe("consumePendingKickoff", () => {
    /** @scenario "The panel sends the kickoff exactly once" */
    it("clears the queued kickoff so the panel sends it once", () => {
      useLangyStore.getState().queueGuidedKickoff(KICKOFF);
      expect(useLangyStore.getState().pendingKickoff).not.toBeNull();
      useLangyStore.getState().consumePendingKickoff();
      expect(useLangyStore.getState().pendingKickoff).toBeNull();
    });
  });

  describe("given a new chat starts while a kickoff is queued", () => {
    it("drops the kickoff with the rest of the conversation state", () => {
      useLangyStore.getState().queueGuidedKickoff(KICKOFF);
      useLangyStore.getState().startNewConversation();
      expect(useLangyStore.getState().pendingKickoff).toBeNull();
    });
  });
});
