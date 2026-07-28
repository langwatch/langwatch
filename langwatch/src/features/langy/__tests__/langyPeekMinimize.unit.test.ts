// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useLangyStore } from "../stores/langyStore";

/**
 * Minimise-to-peek is a MINIMISE, not a close: `isOpen: false` sinks the
 * panel to its edge peek with everything underneath intact, and opening from
 * the peek (click, Enter, or the Cmd/Ctrl+I toggle) brings the same surface
 * back. These pin the store transitions the peek stands on.
 *
 * Spec: specs/langy/langy-peek-dock.feature
 */
describe("Langy minimise-to-peek store transitions", () => {
  beforeEach(() => {
    useLangyStore.getState().resetForProject("project-peek");
    useLangyStore.getState().openPanel();
  });

  describe("given an open panel holding a conversation and a draft", () => {
    beforeEach(() => {
      useLangyStore.getState().selectConversation("conv-1");
      useLangyStore.getState().consumeHistoryLoad();
      useLangyStore.getState().setDraft("half a question");
    });

    describe("when the user minimises the panel", () => {
      beforeEach(() => {
        useLangyStore.getState().closePanel();
      });

      it("sinks to the peek — minimised, not gone", () => {
        expect(useLangyStore.getState().isOpen).toBe(false);
      });

      it("keeps the conversation pointer untouched underneath", () => {
        expect(useLangyStore.getState().activeConversationId).toBe("conv-1");
      });

      it("keeps the half-typed draft untouched underneath", () => {
        expect(useLangyStore.getState().draft).toBe("half a question");
      });

      it("keeps the user's layout choice", () => {
        useLangyStore.getState().openPanel();
        useLangyStore.getState().setPanelMode("sidebar");
        useLangyStore.getState().closePanel();
        expect(useLangyStore.getState().panelMode).toBe("sidebar");
      });

      describe("when the peek is activated", () => {
        it("opens the same surface back up — conversation and draft intact", () => {
          useLangyStore.getState().openPanel();
          const state = useLangyStore.getState();
          expect(state.isOpen).toBe(true);
          expect(state.activeConversationId).toBe("conv-1");
          expect(state.draft).toBe("half a question");
        });
      });
    });
  });

  describe("given the panel is minimised", () => {
    beforeEach(() => {
      useLangyStore.getState().closePanel();
    });

    describe("when the keyboard toggle fires", () => {
      it("opens the panel — the command activation never depends on the pointer", () => {
        useLangyStore.getState().togglePanel();
        expect(useLangyStore.getState().isOpen).toBe(true);
      });
    });

    describe("when a question arrives via askLangy", () => {
      it("opens the panel over the peek and queues the question", () => {
        useLangyStore.getState().askLangy("why are my traces failing");
        const state = useLangyStore.getState();
        expect(state.isOpen).toBe(true);
        expect(state.pendingPrompt).toBe("why are my traces failing");
      });
    });
  });

  describe("given the panel is open", () => {
    describe("when the keyboard toggle fires", () => {
      it("minimises to the peek", () => {
        useLangyStore.getState().togglePanel();
        expect(useLangyStore.getState().isOpen).toBe(false);
      });
    });
  });
});
