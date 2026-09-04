import { describe, expect, it } from "vitest";
import {
  evaluationFailsRun,
  gatedStatus,
  gatedVerdict,
} from "../scenario-evaluation-gate";
import type { ScenarioEvaluationResult } from "../schemas/event-schemas";

function evaluation(
  overrides: Partial<ScenarioEvaluationResult> = {},
): ScenarioEvaluationResult {
  return {
    evaluatorId: "eval-1",
    name: "Check",
    status: "passed",
    required: true,
    ...overrides,
  };
}

describe("gatedVerdict", () => {
  describe("given evaluations that are skipped, scored and passed", () => {
    /** @scenario "The gate reads only required failures and errors" */
    it("keeps the judge's verdict", () => {
      const evaluations = [
        evaluation({
          status: "skipped",
          details: "no golden_sql on this scenario",
        }),
        evaluation({ status: "scored", score: 0.2, required: false }),
        evaluation({ status: "passed", passed: true }),
      ];

      expect(gatedVerdict({ evaluations, judgeVerdict: "success" })).toBe(
        "success",
      );
      expect(gatedVerdict({ evaluations, judgeVerdict: "failure" })).toBe(
        "failure",
      );
      expect(
        gatedVerdict({ evaluations, judgeVerdict: undefined }),
      ).toBeUndefined();
    });
  });

  describe("given a required evaluation that failed", () => {
    it("turns the verdict to failure", () => {
      expect(
        gatedVerdict({
          evaluations: [evaluation({ status: "failed", passed: false })],
          judgeVerdict: "success",
        }),
      ).toBe("failure");
    });
  });

  describe("given a required evaluation with the status error", () => {
    it("turns the verdict to failure", () => {
      expect(
        gatedVerdict({
          evaluations: [evaluation({ status: "error", details: "timeout" })],
          judgeVerdict: "success",
        }),
      ).toBe("failure");
    });
  });

  describe("given a failed evaluation that is not required", () => {
    it("keeps the judge's verdict", () => {
      const evaluations = [
        evaluation({ status: "failed", passed: false, required: false }),
      ];
      expect(gatedVerdict({ evaluations, judgeVerdict: "success" })).toBe(
        "success",
      );
      expect(evaluationFailsRun(evaluations[0]!)).toBe(false);
    });
  });
});

describe("gatedStatus", () => {
  describe("given a judged run", () => {
    it("follows the gated verdict", () => {
      expect(gatedStatus({ status: "SUCCESS", verdict: "failure" })).toBe(
        "FAILURE",
      );
      expect(gatedStatus({ status: "FAILURE", verdict: "success" })).toBe(
        "SUCCESS",
      );
      expect(gatedStatus({ status: "SUCCESS", verdict: "inconclusive" })).toBe(
        "FAILURE",
      );
    });
  });

  describe("given a run that errored or was cancelled", () => {
    it("keeps the status whatever the evaluators said", () => {
      expect(gatedStatus({ status: "ERROR", verdict: "success" })).toBe(
        "ERROR",
      );
      expect(gatedStatus({ status: "CANCELLED", verdict: "failure" })).toBe(
        "CANCELLED",
      );
    });
  });

  describe("given no verdict", () => {
    it("keeps the status", () => {
      expect(gatedStatus({ status: "SUCCESS", verdict: undefined })).toBe(
        "SUCCESS",
      );
    });
  });
});
