import { describe, expect, it } from "vitest";
import {
  consumeDraftKeptOnSubFlowReturn,
  keepDraftOnSubFlowReturn,
} from "../subFlow";

describe("automation drawer sub-flow return intent", () => {
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
        // Nothing announces a return: the user went to another page.
        expect(consumeDraftKeptOnSubFlowReturn()).toBe(false);
      });
    });
  });
});
