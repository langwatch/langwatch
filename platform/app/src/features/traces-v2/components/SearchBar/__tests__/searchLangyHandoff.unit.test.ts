import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handOffSearchToLangy,
  SEARCH_HANDOFF_DRAFT,
} from "../searchLangyHandoff";

/**
 * The search bar's ask affordance handed to Langy — what a typed question and
 * the applied search become on the panel. Spec: specs/traces-v2/search.feature
 * ("The search bar's ask affordance belongs to Langy when Langy is available").
 */
describe("handOffSearchToLangy", () => {
  const askLangy = vi.fn();
  const openPanel = vi.fn();
  const attachContext = vi.fn();
  const seedDraft = vi.fn();

  beforeEach(() => {
    askLangy.mockClear();
    openPanel.mockClear();
    attachContext.mockClear();
    seedDraft.mockClear();
  });

  describe("given the user typed a question", () => {
    it("asks Langy the trimmed question on a fresh conversation", () => {
      handOffSearchToLangy({
        typedText: "  why are checkout traces failing  ",
        appliedQueryText: "",
        askLangy,
        openPanel,
        attachContext,
        seedDraft,
      });

      expect(askLangy).toHaveBeenCalledWith("why are checkout traces failing");
      // askLangy already opens the panel; a second open would be noise.
      expect(openPanel).not.toHaveBeenCalled();
    });

    describe("when a filter is also applied", () => {
      it("attaches the applied search as context alongside the question", () => {
        handOffSearchToLangy({
          typedText: "which of these are timeouts?",
          appliedQueryText: "status:error",
          askLangy,
          openPanel,
          attachContext,
          seedDraft,
        });

        expect(askLangy).toHaveBeenCalledWith("which of these are timeouts?");
        expect(attachContext).toHaveBeenCalledWith({
          type: "filter",
          id: "status:error",
          label: "filtered: status:error",
        });
      });
    });
  });

  describe("given the whole view is known", () => {
    /** @scenario "Ask Langy sends the whole view with the question" */
    it("attaches the view before the filter, so the explicit route sends at least the page context", () => {
      handOffSearchToLangy({
        typedText: "which of these are timeouts?",
        appliedQueryText: "status:error",
        viewContext: {
          id: "view:traces:all-traces:30d:status:error",
          kind: "filter",
          label: "Traces · All traces · Last 30 days · searched",
          ref: "data source: traces; time range: Last 30 days; search and attribute filters: status:error",
        },
        askLangy,
        openPanel,
        attachContext,
        seedDraft,
      });

      expect(attachContext).toHaveBeenNthCalledWith(1, {
        type: "filter",
        id: "data source: traces; time range: Last 30 days; search and attribute filters: status:error",
        label: "Traces · All traces · Last 30 days · searched",
      });
      expect(attachContext).toHaveBeenNthCalledWith(2, {
        type: "filter",
        id: "status:error",
        label: "filtered: status:error",
      });
    });
  });

  describe("given the seed", () => {
    it("is never planted over a question the user actually typed", () => {
      handOffSearchToLangy({
        typedText: "why are checkout traces failing",
        appliedQueryText: "",
        askLangy,
        openPanel,
        attachContext,
        seedDraft,
      });

      expect(seedDraft).not.toHaveBeenCalled();
    });
  });

  describe("given nothing was typed", () => {
    // Opening an empty panel and nothing else is what made the button look
    // broken: you clicked "Ask Langy" and the search you were working on was
    // simply left behind.
    it("starts the sentence for them rather than opening an empty panel", () => {
      handOffSearchToLangy({
        typedText: "   ",
        appliedQueryText: "",
        askLangy,
        openPanel,
        attachContext,
        seedDraft,
      });

      expect(openPanel).toHaveBeenCalled();
      expect(seedDraft).toHaveBeenCalledWith(SEARCH_HANDOFF_DRAFT);
      // An unfinished line, so the reader completes it instead of reading it
      // as a question that has already been asked.
      expect(SEARCH_HANDOFF_DRAFT.endsWith(" ")).toBe(true);
      expect(askLangy).not.toHaveBeenCalled();
    });

    it("opens the panel without queuing a question", () => {
      handOffSearchToLangy({
        typedText: "   ",
        appliedQueryText: "",
        askLangy,
        openPanel,
        attachContext,
        seedDraft,
      });

      expect(openPanel).toHaveBeenCalled();
      expect(askLangy).not.toHaveBeenCalled();
    });

    describe("when a filter is applied", () => {
      it("still attaches the search so the question-to-come is scoped", () => {
        handOffSearchToLangy({
          typedText: undefined,
          appliedQueryText: "status:error",
          askLangy,
          openPanel,
          attachContext,
          seedDraft,
        });

        expect(openPanel).toHaveBeenCalled();
        expect(attachContext).toHaveBeenCalledWith({
          type: "filter",
          id: "status:error",
          label: "filtered: status:error",
        });
      });
    });
  });

  describe("given the typed text is exactly the applied filter", () => {
    /** @scenario "A question that is just the applied filter is not attached twice" */
    it("asks the question without attaching a duplicate of it", () => {
      handOffSearchToLangy({
        typedText: "status:error",
        appliedQueryText: "status:error",
        askLangy,
        openPanel,
        attachContext,
        seedDraft,
      });

      expect(askLangy).toHaveBeenCalledWith("status:error");
      expect(attachContext).not.toHaveBeenCalled();
    });
  });

  describe("given no filter is applied", () => {
    it("attaches nothing", () => {
      handOffSearchToLangy({
        typedText: "how slow was checkout yesterday?",
        appliedQueryText: "   ",
        askLangy,
        openPanel,
        attachContext,
        seedDraft,
      });

      expect(attachContext).not.toHaveBeenCalled();
    });
  });
});
