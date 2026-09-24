import { describe, expect, it } from "vitest";

import {
  CLUSTERING_FAILURE_GUIDANCE,
  failureGuidance,
  runDetail,
  showsModelProvidersLink,
} from "../topic-clustering-copy";

/**
 * The copy module is the code→customer-words mapping for the topic-clustering
 * settings page (issue #8287). These pin the restricted-model guidance and the
 * failed-run detail so the wording is checked without rendering the page.
 */
describe("topic-clustering-copy", () => {
  describe("given a restricted-model failure", () => {
    /** @scenario "The settings page shows guidance and a link for a restricted model failure" */
    it("has named guidance for model_restricted", () => {
      const guidance = CLUSTERING_FAILURE_GUIDANCE.model_restricted;
      expect(guidance?.title).toBe(
        "The topic clustering model is not allowed for this feature",
      );
      expect(guidance?.description).toContain("Codex");
    });

    /** @scenario "The settings page shows guidance and a link for a restricted model failure" */
    it("shows the restricted guidance title for a failed user-actionable model_restricted run", () => {
      const run = {
        outcome: "failed",
        mode: null,
        skippedReason: null,
        errorCode: "model_restricted",
        isErrorUserActionable: true,
        tracesProcessed: 0,
        topicsCount: 0,
        subtopicsCount: 0,
      };

      expect(runDetail(run)).toBe(
        "The topic clustering model is not allowed for this feature",
      );
      expect(showsModelProvidersLink(run)).toBe(true);
    });
  });

  describe("failureGuidance", () => {
    describe("given an actionable failure with a known code", () => {
      it("returns the guidance entry for that code", () => {
        expect(
          failureGuidance({
            errorCode: "model_restricted",
            isErrorUserActionable: true,
          }),
        ).toBe(CLUSTERING_FAILURE_GUIDANCE.model_restricted);
      });
    });

    describe("given a non-actionable failure", () => {
      it("returns null even for a known code", () => {
        expect(
          failureGuidance({
            errorCode: "model_restricted",
            isErrorUserActionable: false,
          }),
        ).toBeNull();
      });
    });

    describe("given an unknown code", () => {
      it("returns null", () => {
        expect(
          failureGuidance({
            errorCode: "internal",
            isErrorUserActionable: true,
          }),
        ).toBeNull();
      });
    });
  });

  describe("given an internal failure", () => {
    it("degrades to the generic our-side detail and offers no link", () => {
      const run = {
        outcome: "failed",
        mode: null,
        skippedReason: null,
        errorCode: "internal",
        isErrorUserActionable: false,
        tracesProcessed: 0,
        topicsCount: 0,
        subtopicsCount: 0,
      };

      expect(runDetail(run)).toBe(
        "Failed on our side. It retries automatically at the next scheduled run.",
      );
      expect(showsModelProvidersLink(run)).toBe(false);
    });
  });
});
