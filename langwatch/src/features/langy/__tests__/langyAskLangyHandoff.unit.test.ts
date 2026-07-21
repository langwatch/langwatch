import { describe, expect, it, beforeEach } from "vitest";
import { useLangyStore } from "../stores/langyStore";

/**
 * The command bar's "Ask Langy" hands a question to the panel through the store:
 * `askLangy` opens the panel on a fresh conversation and QUEUES the question;
 * the panel's effect auto-sends it and calls `consumePendingPrompt` so it fires
 * exactly once. This pins that contract (spec:
 * specs/langy/langy-command-bar-activation.feature).
 */
describe("askLangy — command-bar → panel handoff", () => {
  beforeEach(() => {
    useLangyStore.getState().resetForProject();
  });

  describe("given a question typed in the command bar", () => {
    beforeEach(() => {
      // Leave some abandoned conversation state around to prove askLangy starts
      // clean rather than asking into whatever was open before.
      useLangyStore.getState().selectConversation("conv-old");
      useLangyStore.getState().setDraft("half a thought");
    });

    it("opens the panel", () => {
      useLangyStore.getState().askLangy("why are my traces failing");
      expect(useLangyStore.getState().isOpen).toBe(true);
    });

    it("queues the trimmed question for the panel to send", () => {
      useLangyStore.getState().askLangy("  why are my traces failing  ");
      expect(useLangyStore.getState().pendingPrompt).toBe(
        "why are my traces failing",
      );
    });

    it("starts a fresh conversation — no old pointer, no old draft", () => {
      useLangyStore.getState().askLangy("summarise last night's runs");
      const state = useLangyStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(state.historyLoadConversationId).toBeNull();
      expect(state.draft).toBe("");
    });
  });

  describe("given an empty or whitespace-only prompt", () => {
    it("still opens the panel but queues nothing to send", () => {
      useLangyStore.getState().askLangy("   ");
      const state = useLangyStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.pendingPrompt).toBeNull();
    });
  });

  describe("consumePendingPrompt", () => {
    it("clears the queued prompt so the panel sends it exactly once", () => {
      useLangyStore.getState().askLangy("find the slowest traces");
      expect(useLangyStore.getState().pendingPrompt).not.toBeNull();
      useLangyStore.getState().consumePendingPrompt();
      expect(useLangyStore.getState().pendingPrompt).toBeNull();
    });
  });

  describe("given a queued prompt and the user then starts a new chat by hand", () => {
    it("drops the queued question — it belonged to the previous ask", () => {
      useLangyStore.getState().askLangy("open a PR that fixes the regression");
      expect(useLangyStore.getState().pendingPrompt).not.toBeNull();
      useLangyStore.getState().startNewConversation();
      expect(useLangyStore.getState().pendingPrompt).toBeNull();
    });
  });
});
