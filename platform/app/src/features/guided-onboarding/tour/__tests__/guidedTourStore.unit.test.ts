import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGuidedTourStore } from "../guidedTourStore";

const reset = () =>
  useGuidedTourStore.setState({
    running: false,
    path: null,
    stepIndex: 0,
    handoff: null,
    runId: 0,
    onEnd: null,
  });

describe("guided tour store", () => {
  beforeEach(reset);

  describe("when a path with a tour starts", () => {
    it("runs from step 1 with a fresh run id", () => {
      useGuidedTourStore.getState().start("llmops");
      const s = useGuidedTourStore.getState();
      expect(s.running).toBe(true);
      expect(s.path).toBe("llmops");
      expect(s.stepIndex).toBe(0);
      expect(s.runId).toBe(1);
    });
  });

  describe("when the coding path starts", () => {
    /** @scenario the coding path queues the kickoff with no tour */
    it("ends at once as completed without running", () => {
      const onEnd = vi.fn();
      useGuidedTourStore.getState().start("coding", { onEnd });
      expect(useGuidedTourStore.getState().running).toBe(false);
      expect(onEnd).toHaveBeenCalledWith("completed");
    });
  });

  describe("when the run ends", () => {
    /** @scenario the kickoff is queued exactly once when the tour ends */
    it("calls the end callback once and never again", () => {
      const onEnd = vi.fn();
      useGuidedTourStore.getState().start("llmops", { onEnd });
      useGuidedTourStore.getState().end("skipped");
      useGuidedTourStore.getState().end("completed");
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(onEnd).toHaveBeenCalledWith("skipped");
      expect(useGuidedTourStore.getState().running).toBe(false);
    });
  });

  describe("when the card asks for a replay", () => {
    /** @scenario replay from the card runs the tour from step 1 */
    it("runs the last path again from step 1 with no end callback", () => {
      const onEnd = vi.fn();
      useGuidedTourStore.getState().start("gateway", { onEnd });
      useGuidedTourStore.getState().goToStep(3);
      useGuidedTourStore.getState().end("completed");
      useGuidedTourStore.getState().replay();
      const s = useGuidedTourStore.getState();
      expect(s.running).toBe(true);
      expect(s.path).toBe("gateway");
      expect(s.stepIndex).toBe(0);
      expect(s.runId).toBe(2);
      useGuidedTourStore.getState().end("completed");
      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it("does nothing before any tour ran when no path is named", () => {
      useGuidedTourStore.getState().replay();
      expect(useGuidedTourStore.getState().running).toBe(false);
    });

    /** @scenario replay from the card runs the tour from step 1 */
    it("runs the path the card names, even before any tour ran here", () => {
      useGuidedTourStore.getState().replay("gateway");
      const s = useGuidedTourStore.getState();
      expect(s.running).toBe(true);
      expect(s.path).toBe("gateway");
      expect(s.stepIndex).toBe(0);
      expect(s.onEnd).toBeNull();
    });
  });

  describe("when a step is chosen", () => {
    /** @scenario the counter does nothing on the first step */
    it("stays inside the path's steps", () => {
      useGuidedTourStore.getState().start("llmops");
      useGuidedTourStore.getState().goToStep(-1);
      expect(useGuidedTourStore.getState().stepIndex).toBe(0);
      useGuidedTourStore.getState().goToStep(4);
      expect(useGuidedTourStore.getState().stepIndex).toBe(0);
      useGuidedTourStore.getState().goToStep(2);
      expect(useGuidedTourStore.getState().stepIndex).toBe(2);
    });
  });
});
