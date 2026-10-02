import { describe, expect, it } from "vitest";
import { manualTriggerFeedback } from "./topic-clustering-trigger-feedback";

describe("given a manual topic clustering result", () => {
  describe("when the request is disabled", () => {
    /** @scenario A disabled manual request is not reported as started */
    it("shows disabled feedback without a success toast", () => {
      expect(
        manualTriggerFeedback({ started: false, reason: "disabled" }),
      ).toEqual({
        title: "Topic clustering is temporarily disabled",
        description: "No new run was started. Please try again later.",
        type: "info",
      });
    });
  });

  describe("when the request is accepted", () => {
    /** @scenario An enabled manual request keeps its accepted feedback */
    it("preserves accepted-run success feedback", () => {
      expect(manualTriggerFeedback({ started: true })).toEqual({
        title: "Topic clustering started",
        description: "This can take several minutes.",
        type: "success",
      });
    });
  });

  describe("when a run is already in progress", () => {
    it("preserves already-running feedback", () => {
      expect(
        manualTriggerFeedback({ started: false, reason: "already_running" })
          .title,
      ).toBe("A run is already in progress");
    });
  });
});
