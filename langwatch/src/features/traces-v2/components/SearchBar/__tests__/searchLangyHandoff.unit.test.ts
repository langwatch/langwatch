import { beforeEach, describe, expect, it, vi } from "vitest";
import { handOffSearchToLangy } from "../searchLangyHandoff";

/**
 * The search bar's ask affordance handed to Langy — what a typed question and
 * the applied search become on the panel. Spec: specs/traces-v2/search.feature
 * ("The search bar's ask affordance belongs to Langy when Langy is available").
 */
describe("handOffSearchToLangy", () => {
  const askLangy = vi.fn();
  const openPanel = vi.fn();
  const attachContext = vi.fn();

  beforeEach(() => {
    askLangy.mockClear();
    openPanel.mockClear();
    attachContext.mockClear();
  });

  describe("given the user typed a question", () => {
    it("asks Langy the trimmed question on a fresh conversation", () => {
      handOffSearchToLangy({
        typedText: "  why are checkout traces failing  ",
        appliedQueryText: "",
        askLangy,
        openPanel,
        attachContext,
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

  describe("given nothing was typed", () => {
    it("opens the panel without queuing a question", () => {
      handOffSearchToLangy({
        typedText: "   ",
        appliedQueryText: "",
        askLangy,
        openPanel,
        attachContext,
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
    it("asks the question without attaching a duplicate of it", () => {
      handOffSearchToLangy({
        typedText: "status:error",
        appliedQueryText: "status:error",
        askLangy,
        openPanel,
        attachContext,
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
      });

      expect(attachContext).not.toHaveBeenCalled();
    });
  });
});
