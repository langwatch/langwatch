import { describe, expect, it } from "vitest";
import { consumeDraftKeptForSubFlow, keepDraftForSubFlow } from "../subFlow";

describe("automation drawer sub-flow intent", () => {
  describe("given the drawer leaves for a sub-flow", () => {
    describe("when the unmount asks whether to keep the draft", () => {
      it("says yes once, then no", () => {
        keepDraftForSubFlow();

        expect(consumeDraftKeptForSubFlow()).toBe(true);
        // The close that follows the return trip must reset as usual.
        expect(consumeDraftKeptForSubFlow()).toBe(false);
      });
    });
  });

  describe("given no sub-flow was announced", () => {
    describe("when the drawer unmounts", () => {
      it("says no, so a plain close resets", () => {
        expect(consumeDraftKeptForSubFlow()).toBe(false);
      });
    });
  });
});
