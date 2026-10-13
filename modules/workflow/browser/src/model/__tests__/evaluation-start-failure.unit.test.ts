import { describe, expect, it } from "vitest";

import { evaluationStartFailure } from "../evaluation-start-failure.ts";

describe("evaluationStartFailure()", () => {
  describe("when the dialog's own attempt failed", () => {
    it("answers the failure the run reported", () => {
      expect(
        evaluationStartFailure({
          hasStarted: true,
          evaluation: { status: "error", error: "Couldn't run this workflow. Try again." },
        }),
      ).toBe("Couldn't run this workflow. Try again.");
    });

    it("answers a default line when the run reported none", () => {
      expect(evaluationStartFailure({ hasStarted: true, evaluation: { status: "error" } })).toBe(
        "The evaluation did not start. Try again.",
      );
    });
  });

  describe("when the dialog has not asked for a run", () => {
    it("ignores an older run's error", () => {
      expect(
        evaluationStartFailure({
          hasStarted: false,
          evaluation: { status: "error", error: "Timeout" },
        }),
      ).toBeUndefined();
    });
  });

  describe("when the run is waiting or running", () => {
    it.each(["waiting", "running", "success"])("answers nothing for %s", (status) => {
      expect(evaluationStartFailure({ hasStarted: true, evaluation: { status } })).toBeUndefined();
    });
  });
});
