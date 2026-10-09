import { describe, expect, it } from "vitest";
import { isGuidedPathActive } from "../guidedPathActive";

describe("isGuidedPathActive", () => {
  describe("given the tour is running", () => {
    describe("when the state names no path yet", () => {
      /** @scenario "no other coach mark starts while a guided path is active" */
      it("is active", () => {
        expect(
          isGuidedPathActive({
            state: { donePaths: [] },
            tourRunning: true,
          }),
        ).toBe(true);
      });
    });
  });

  describe("given a path is current", () => {
    describe("when it is not done yet", () => {
      it("is active", () => {
        expect(
          isGuidedPathActive({
            state: { currentPath: "llmops", donePaths: [] },
            tourRunning: false,
          }),
        ).toBe(true);
      });
    });

    describe("when it is done", () => {
      it("is not active", () => {
        expect(
          isGuidedPathActive({
            state: { currentPath: "llmops", donePaths: ["llmops"] },
            tourRunning: false,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given the organization is not in the guided variant", () => {
    describe("when the state is absent", () => {
      it("is not active", () => {
        expect(isGuidedPathActive({ state: null, tourRunning: false })).toBe(
          false,
        );
      });
    });
  });
});
