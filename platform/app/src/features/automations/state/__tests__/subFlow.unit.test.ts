import { describe, expect, it } from "vitest";
import {
  consumeDraftKeptForSubFlow,
  consumeDraftKeptOnSubFlowReturn,
  keepDraftForSubFlow,
  keepDraftOnSubFlowReturn,
} from "../subFlow";

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

  describe("given the sub-flow announces its return", () => {
    describe("when the drawer mounts", () => {
      it("says keep the draft once, then blank again", () => {
        keepDraftOnSubFlowReturn();

        expect(consumeDraftKeptOnSubFlowReturn()).toBe(true);
        // A later open is a new automation and must start empty.
        expect(consumeDraftKeptOnSubFlowReturn()).toBe(false);
      });
    });
  });

  describe("given the user left the sub-flow without returning", () => {
    describe("when the drawer mounts for a new automation", () => {
      /** @scenario "An abandoned sub-flow does not seed the next automation" */
      it("says start blank, so the abandoned draft is discarded", () => {
        // The departure keeps the draft across its own unmount.
        keepDraftForSubFlow();
        expect(consumeDraftKeptForSubFlow()).toBe(true);

        // Nothing announces a return: the user went to another page.
        expect(consumeDraftKeptOnSubFlowReturn()).toBe(false);
      });
    });
  });
});
