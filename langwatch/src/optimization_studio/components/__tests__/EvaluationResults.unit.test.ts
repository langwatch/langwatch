/**
 * Unit tests for the experiment query enabled condition.
 *
 * Regression test for #2330: evaluation results disappear on page refresh
 * because the experiment query was gated behind in-memory evaluationState,
 * which resets to undefined on refresh.
 */
import { describe, expect, it } from "vitest";
import { isExperimentQueryEnabled } from "../evaluationQueryEnabled";

describe("isExperimentQueryEnabled()", () => {
  describe("when workflowId exists and project is available (post-refresh)", () => {
    it("returns true without requiring evaluationState", () => {
      const result = isExperimentQueryEnabled({
        hasProject: true,
        workflowId: "my-workflow-id",
      });

      expect(result).toBe(true);
    });
  });

  describe("when workflowId is undefined", () => {
    it("returns false", () => {
      const result = isExperimentQueryEnabled({
        hasProject: true,
        workflowId: undefined,
      });

      expect(result).toBe(false);
    });
  });

  describe("when project is not available", () => {
    it("returns false", () => {
      const result = isExperimentQueryEnabled({
        hasProject: false,
        workflowId: "my-workflow-id",
      });

      expect(result).toBe(false);
    });
  });

  describe("when both project and workflowId are available", () => {
    it("returns true", () => {
      const result = isExperimentQueryEnabled({
        hasProject: true,
        workflowId: "some-id",
      });

      expect(result).toBe(true);
    });
  });
});
