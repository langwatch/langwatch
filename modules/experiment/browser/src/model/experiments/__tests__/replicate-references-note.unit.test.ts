import { describe, expect, it } from "vitest";

import { replicateReferencesNote } from "../replicate-references-note.ts";

describe("replicateReferencesNote", () => {
  describe("given the target is the current project", () => {
    describe("when the note is chosen", () => {
      /** @scenario "The replicate dialog says prompts, evaluators and agents are shared within the same project" */
      it("says they are shared with the original", () => {
        expect(
          replicateReferencesNote({
            experimentType: "EVALUATIONS_V3",
            sourceProjectId: "p1",
            targetProjectId: "p1",
          }),
        ).toBe(
          "Prompts, evaluators and agents are shared with the original. Editing them in the copy also changes the original.",
        );
      });
    });
  });

  describe("given the target is another project", () => {
    describe("when the note is chosen", () => {
      /** @scenario "The replicate dialog says prompts, evaluators and agents are not copied to another project" */
      it("says they are not copied", () => {
        expect(
          replicateReferencesNote({
            experimentType: "EVALUATIONS_V3",
            sourceProjectId: "p1",
            targetProjectId: "p2",
          }),
        ).toBe(
          "Prompts, evaluators and agents are not copied. The copy needs them to exist in the target project.",
        );
      });
    });
  });

  describe("given no target is selected", () => {
    describe("when the note is chosen", () => {
      it("shows nothing", () => {
        expect(
          replicateReferencesNote({
            experimentType: "EVALUATIONS_V3",
            sourceProjectId: "p1",
            targetProjectId: undefined,
          }),
        ).toBeUndefined();
      });
    });
  });

  describe("given a workflow-based experiment", () => {
    describe("when another project is the target", () => {
      /** @scenario "The note is not shown for a workflow-based experiment" */
      it("shows nothing", () => {
        expect(
          replicateReferencesNote({
            experimentType: "BATCH_EVALUATION_V2",
            sourceProjectId: "p1",
            targetProjectId: "p2",
          }),
        ).toBeUndefined();
      });
    });
  });
});
