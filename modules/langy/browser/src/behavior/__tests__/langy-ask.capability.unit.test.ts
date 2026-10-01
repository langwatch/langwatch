/**
 * The ask capability: what another module's question becomes on the panel,
 * proven against the store it writes.
 */
import { useLangyStore } from "@langwatch/langy-browser-kit";
import { beforeEach, describe, expect, it } from "vitest";

import { langyAsk } from "../langy-ask.capability.ts";

const view = {
  kind: "filter" as const,
  ref: "data source: traces; time range: Last 30 days",
  label: "Traces · Last 30 days",
};

beforeEach(() => {
  useLangyStore.setState({ isOpen: false, draft: "", attachedContext: [] });
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

    it("never plants the seed over a half-written question", () => {
      useLangyStore.setState({ draft: "why is checkout " });

      langyAsk.ask({ draft: "Find traces where " });

      expect(useLangyStore.getState().draft).toBe("why is checkout ");
    });
  });
});
