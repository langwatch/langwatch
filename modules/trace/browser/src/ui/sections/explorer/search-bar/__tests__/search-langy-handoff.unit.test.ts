import type { TraceViewContextChip } from "@langwatch/trace-browser-kit";
import { describe, expect, it } from "vitest";

import { handOffSearchToLangy, SEARCH_HANDOFF_DRAFT } from "../search-langy-handoff.ts";

const view: TraceViewContextChip = {
  id: "view:traces:all-traces:30d:status:error",
  kind: "filter",
  label: "Traces · All traces · Last 30 days · searched",
  ref: "data source: traces; time range: Last 30 days; search and attribute filters: status:error",
};

/**
 * The search bar's ask affordance handed to Langy — what a typed question and
 * the applied search become on the panel. Spec: specs/traces-v2/search.feature
 * ("The search bar's ask affordance belongs to Langy when Langy is available").
 */
describe("handOffSearchToLangy", () => {
  describe("given the user typed a question", () => {
    it("asks Langy the trimmed question on a fresh conversation", () => {
      const request = handOffSearchToLangy({
        typedText: "  why are checkout traces failing  ",
        appliedQueryText: "",
      });

      expect(request.question).toBe("why are checkout traces failing");
      // A question is asked outright — the composer is never seeded over it.
      expect(request.draft).toBeUndefined();
    });

    describe("when a filter is also applied", () => {
      it("attaches the applied search as context alongside the question", () => {
        const request = handOffSearchToLangy({
          typedText: "which of these are timeouts?",
          appliedQueryText: "status:error",
        });

        expect(request.question).toBe("which of these are timeouts?");
        expect(request.context).toEqual([
          { kind: "filter", ref: "status:error", label: "filtered: status:error" },
        ]);
      });
    });
  });

  describe("given the whole view is known", () => {
    /** @scenario "Ask Langy sends the whole view with the question" */
    it("attaches the view before the filter, so the explicit route sends at least the page context", () => {
      const request = handOffSearchToLangy({
        typedText: "which of these are timeouts?",
        appliedQueryText: "status:error",
        viewContext: view,
      });

      expect(request.context).toEqual([
        { kind: "filter", ref: view.ref, label: view.label },
        { kind: "filter", ref: "status:error", label: "filtered: status:error" },
      ]);
    });
  });

  describe("given nothing was typed", () => {
    // Opening an empty panel and nothing else is what made the button look
    // broken: the search you were working on was simply left behind.
    it("starts the sentence for them rather than opening an empty panel", () => {
      const request = handOffSearchToLangy({ typedText: "   ", appliedQueryText: "" });

      expect(request.draft).toBe(SEARCH_HANDOFF_DRAFT);
      // An unfinished line, so the reader completes it instead of reading it
      // as a question that has already been asked.
      expect(SEARCH_HANDOFF_DRAFT.endsWith(" ")).toBe(true);
      expect(request.question).toBeUndefined();
    });

    describe("when a filter is applied", () => {
      it("still attaches the search so the question-to-come is scoped", () => {
        const request = handOffSearchToLangy({
          typedText: void 0,
          appliedQueryText: "status:error",
        });

        expect(request.question).toBeUndefined();
        expect(request.context).toEqual([
          { kind: "filter", ref: "status:error", label: "filtered: status:error" },
        ]);
      });
    });
  });

  describe("given the typed text is exactly the applied filter", () => {
    /** @scenario "A question that is just the applied filter is not attached twice" */
    it("asks the question without attaching a duplicate of it", () => {
      const request = handOffSearchToLangy({
        typedText: "status:error",
        appliedQueryText: "status:error",
      });

      expect(request.question).toBe("status:error");
      expect(request.context).toBeUndefined();
    });
  });

  describe("given no filter is applied", () => {
    it("attaches nothing", () => {
      const request = handOffSearchToLangy({
        typedText: "how slow was checkout yesterday?",
        appliedQueryText: "   ",
      });

      expect(request.context).toBeUndefined();
    });
  });
});
