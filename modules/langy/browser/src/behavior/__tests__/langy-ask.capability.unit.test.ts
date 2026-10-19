import { beforeEach, describe, expect, it } from "vitest";

import { createLangyAsk, langyAsk } from "../langy-ask.capability.ts";
/**
 * The ask capability: what another module's question becomes on the panel,
 * proven against the store it writes.
 */
import { useLangyStore } from "../langy.store.ts";

const view = {
  kind: "filter" as const,
  ref: "data source: traces; time range: Last 30 days",
  label: "Traces · Last 30 days",
};

beforeEach(() => {
  useLangyStore.setState({
    isOpen: false,
    draft: "",
    pendingPrompt: null,
    attachedContext: [],
    composerFocusRequested: false,
  });
});

describe("given another module asking Langy a question", () => {
  describe("when the question is typed", () => {
    it("asks it outright, with the view attached to the conversation it starts", () => {
      langyAsk.ask({ question: "  why are these failing?  ", context: [view] });

      const state = useLangyStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.pendingPrompt).toBe("why are these failing?");
      expect(state.attachedContext).toEqual([{ type: "filter", id: view.ref, label: view.label }]);
    });
  });

  describe("when nothing was typed", () => {
    it("opens the composer with the sentence started", () => {
      langyAsk.ask({ draft: "Find traces where ", context: [view] });

      expect(useLangyStore.getState().isOpen).toBe(true);
      expect(useLangyStore.getState().draft).toBe("Find traces where ");
    });

    it("opens the panel with the cursor in the composer when nothing is asked", () => {
      langyAsk.ask({ context: [view] });

      expect(useLangyStore.getState().isOpen).toBe(true);
      expect(useLangyStore.getState().composerFocusRequested).toBe(true);
      expect(useLangyStore.getState().pendingPrompt).toBeFalsy();
    });

    it("never plants the seed over a half-written question", () => {
      useLangyStore.setState({ draft: "why is checkout " });

      langyAsk.ask({ draft: "Find traces where " });

      expect(useLangyStore.getState().draft).toBe("why is checkout ");
    });
  });
});

describe("given a dashboard draft about one board", () => {
  const about = { ref: "board-a" };
  const report = "Write a short report on my board";

  describe("when the draft lands before its board is on screen", () => {
    /** @scenario "Langy drafts: a draft waits until its board is on screen" */
    it("keeps it while the old page is still up, and drops it only after its board has shown", () => {
      const ask = createLangyAsk();
      ask.onScreen({ ref: "templates" });

      ask.ask({ draft: report, about });
      ask.onScreen(null);
      expect(useLangyStore.getState().draft).toBe(report);

      ask.onScreen(about);
      ask.onScreen({ ref: "board-b" });
      expect(useLangyStore.getState().draft).toBe("");
    });

    /** @scenario "Langy drafts: an unsent draft is dropped when the member moves to another board" */
    it("takes the board's context chip with the draft", () => {
      const ask = createLangyAsk();
      ask.onScreen(about);
      ask.ask({
        draft: report,
        about,
        context: [{ kind: "dashboard", ref: "board-a", label: "A" }],
      });
      expect(useLangyStore.getState().attachedContext).toHaveLength(1);

      ask.onScreen({ ref: "board-b" });

      expect(useLangyStore.getState().attachedContext).toEqual([]);
    });
  });

  describe("when the member typed into the draft before leaving the board", () => {
    /** @scenario "Langy drafts: text the member typed is never dropped" */
    it("keeps what they typed", () => {
      const ask = createLangyAsk();
      ask.onScreen(about);
      ask.ask({ draft: report, about });
      useLangyStore.getState().setDraft(`${report} for last week`);

      ask.onScreen({ ref: "board-b" });

      expect(useLangyStore.getState().draft).toBe(`${report} for last week`);
    });
  });

  describe("when a second draft follows an untouched one", () => {
    it("replaces it, since the first was never the reader's", () => {
      const ask = createLangyAsk();
      ask.onScreen(about);
      ask.ask({ draft: report, about });

      ask.ask({ draft: "Explain this widget", about });

      expect(useLangyStore.getState().draft).toBe("Explain this widget");
    });
  });
});
