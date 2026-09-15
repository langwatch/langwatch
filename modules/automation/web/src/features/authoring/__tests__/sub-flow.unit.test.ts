/**
 * Whether the authoring drawer's next mount keeps the draft the previous one
 * left in the singleton store. See specs/automations/authoring-drawer.feature.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  announceSubFlowDeparture,
  consumeDraftKeptOnSubFlowReturn,
  isHandingOverToSubFlow,
  keepDraftOnSubFlowReturn,
} from "../behavior/sub-flow.ts";

beforeEach(() => {
  consumeDraftKeptOnSubFlowReturn();
});

describe("automation drawer sub-flow intents", () => {
  describe("given the sub-flow announces its return", () => {
    describe("when the drawer mounts", () => {
      it("says keep the draft once, then blank again", () => {
        announceSubFlowDeparture();
        keepDraftOnSubFlowReturn();

        expect(consumeDraftKeptOnSubFlowReturn()).toBe(true);
        // A later open is a new automation and must start empty.
        expect(consumeDraftKeptOnSubFlowReturn()).toBe(false);
      });
    });
  });

  describe("given the drawer is handing over rather than closing", () => {
    describe("when its unmount asks twice", () => {
      it("answers the same both times, so a replayed unmount cannot wipe the draft", () => {
        announceSubFlowDeparture();

        expect(isHandingOverToSubFlow()).toBe(true);
        expect(isHandingOverToSubFlow()).toBe(true);
      });
    });
  });

  describe("given the user left the sub-flow without returning", () => {
    describe("when the drawer mounts for a new automation", () => {
      /** @scenario "An abandoned sub-flow does not seed the next automation" */
      it("says start blank, so the abandoned draft is discarded", () => {
        // The hand-over happened; nothing announced a return, because the user
        // went to another page instead of coming back.
        announceSubFlowDeparture();

        expect(consumeDraftKeptOnSubFlowReturn()).toBe(false);
        // and the departure is spent, so the next close resets as it should.
        expect(isHandingOverToSubFlow()).toBe(false);
      });
    });
  });
});
