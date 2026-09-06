import { beforeEach, describe, expect, it } from "vitest";
import { useFocusSectionStore } from "../focusSectionStore";

describe("useFocusSectionStore", () => {
  beforeEach(() => {
    useFocusSectionStore.setState({ pending: null });
  });

  describe("given a focus request for the exceptions section", () => {
    describe("when the status chip is clicked", () => {
      /** @scenario Clicking the error status chip focuses the Exceptions section */
      it("publishes a pending focus payload the trace-summary observer consumes", () => {
        // The status chip's onClick funnels through this store, the
        // accordion observer reads `pending`, expands the section,
        // scrolls + triggers the glow. Testing the store directly keeps
        // the chip's click handler decoupled from the accordion's DOM.
        useFocusSectionStore
          .getState()
          .request({ traceId: "trace-abc", section: "exceptions" });
        const pending = useFocusSectionStore.getState().pending;
        expect(pending?.traceId).toBe("trace-abc");
        expect(pending?.section).toBe("exceptions");
      });
    });
  });

  describe("given a focus request for the evals section", () => {
    describe("when an evaluation chip is clicked", () => {
      /** @scenario Clicking an evaluation chip focuses the Evals section */
      it("publishes a pending focus payload for the evals section", () => {
        useFocusSectionStore
          .getState()
          .request({ traceId: "trace-xyz", section: "evals" });
        const pending = useFocusSectionStore.getState().pending;
        expect(pending?.traceId).toBe("trace-xyz");
        expect(pending?.section).toBe("evals");
      });
    });
  });

  describe("given the same chip is re-clicked while the previous request is still pending", () => {
    describe("when the chip is clicked a second time", () => {
      /** @scenario The focus glow runs a single short pulse so the eye lands without distracting */
      it("bumps the nonce so the observer re-fires the glow + scroll", () => {
        // Without the nonce bump, a second click during the ~1.5s glow
        // window would set the same {traceId, section} state and the
        // observer's effect dep array wouldn't trigger again, the
        // operator would feel like the chip stopped responding. Nonce
        // is the cheap way to make every click distinct in observer
        // identity terms.
        useFocusSectionStore
          .getState()
          .request({ traceId: "trace-abc", section: "exceptions" });
        const first = useFocusSectionStore.getState().pending!.nonce;
        useFocusSectionStore
          .getState()
          .request({ traceId: "trace-abc", section: "exceptions" });
        const second = useFocusSectionStore.getState().pending!.nonce;
        expect(second).toBeGreaterThan(first);
      });
    });
  });
});
