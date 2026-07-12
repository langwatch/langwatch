import { describe, expect, it, beforeEach } from "vitest";
import { useLangyStore } from "../stores/langyStore";

/**
 * "New chat" must actually START a new chat.
 *
 * The reported bug: after a failed turn, hitting New chat left the red error
 * card sitting under an otherwise-empty panel, and the half-typed draft was
 * still in the composer. Two separate leaks, in two separate places — the chat
 * ENGINE's error (useChat state, cleared in the panel via `clearError()`; see
 * `resetChatEngine` in LangyPanel.tsx) and the STORE's draft, pinned here.
 *
 * The store half is what this file guards: `startNewConversation` must leave no
 * field of the abandoned conversation behind, so that adding a field tomorrow
 * and forgetting to reset it fails loudly here.
 */

/** Every field a conversation dirties. A new chat must clear all of them. */
function dirtyTheStore() {
  const store = useLangyStore.getState();
  store.selectConversation("conv-old");
  store.setDraft("half a question I never sent");
  store.setActiveTurnId("turn-old");
  store.setTurnStatus("searching the abandoned turn");
  store.setTurnProgress(0.5);
  store.markProposalApplying("prop-1");
  store.markProposalApplied("prop-2", {});
  store.discardProposal("prop-3");
  store.dismissChip("chip-1");
  store.dismissFeedback("msg-1");
}

describe("startNewConversation", () => {
  beforeEach(() => {
    useLangyStore.getState().resetForProject();
  });

  describe("given a conversation the user is walking away from", () => {
    beforeEach(() => {
      dirtyTheStore();
    });

    it("leaves the composer empty — the abandoned draft does not follow you", () => {
      // The reported bug. `resetForProject` always cleared the draft;
      // `startNewConversation` simply forgot to.
      expect(useLangyStore.getState().draft).not.toBe("");
      useLangyStore.getState().startNewConversation();
      expect(useLangyStore.getState().draft).toBe("");
    });

    it("clears the conversation pointer and its history load", () => {
      useLangyStore.getState().startNewConversation();
      const state = useLangyStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(state.historyLoadConversationId).toBeNull();
    });

    it("drops the abandoned turn — no stale id, no stale live signals", () => {
      // A late signal from the turn we walked away from must have nothing to
      // paint: the onTurnStream subscription is keyed on the turn, and the live
      // status/progress reset with the conversation.
      useLangyStore.getState().startNewConversation();
      const state = useLangyStore.getState();
      expect(state.activeTurnId).toBeNull();
      expect(state.turnStatus).toBeNull();
      expect(state.turnProgress).toBeNull();
    });

    it("resets the proposal lifecycle", () => {
      useLangyStore.getState().startNewConversation();
      const state = useLangyStore.getState();
      expect(state.appliedOutcomes).toEqual({});
      expect(state.applyingProposalIds.size).toBe(0);
      expect(state.discardedProposalIds.size).toBe(0);
    });

    it("restores the page-context chips and the feedback prompt", () => {
      useLangyStore.getState().startNewConversation();
      const state = useLangyStore.getState();
      expect(state.dismissedChipIds.size).toBe(0);
      expect(state.dismissedFeedbackMessageIds.size).toBe(0);
    });

    it("resets every conversation-scoped field — nothing survives", () => {
      // The catch-all. If a conversation-scoped field is added to the store and
      // not reset here, this fails rather than shipping a leak.
      useLangyStore.getState().startNewConversation();
      const after = useLangyStore.getState();
      const fresh = { ...after };
      useLangyStore.getState().resetForProject();
      const baseline = useLangyStore.getState();

      for (const key of [
        "activeConversationId",
        "historyLoadConversationId",
        "draft",
        "activeTurnId",
        "optimisticText",
      ] as const) {
        expect(fresh[key], key).toEqual(baseline[key]);
      }
      for (const key of [
        "dismissedChipIds",
        "dismissedFeedbackMessageIds",
        "applyingProposalIds",
        "discardedProposalIds",
      ] as const) {
        expect(fresh[key].size, key).toBe(baseline[key].size);
      }
      expect(fresh.appliedOutcomes).toEqual(baseline.appliedOutcomes);
    });
  });

  describe("given the user picked a model for this session", () => {
    it("keeps it — the model is a preference, not conversation state", () => {
      useLangyStore.getState().setModelOverride("openai/gpt-5-mini");
      useLangyStore.getState().startNewConversation();
      expect(useLangyStore.getState().modelOverride).toBe("openai/gpt-5-mini");
    });
  });
});
