/**
 * Mapping rules for the drawer's rich evaluation entries (#6835 item 1).
 *
 * A processed evaluation with `passed == null` must map to the neutral
 * "processed" status — never an invented "pass" — and a missing score must
 * stay null rather than becoming a fabricated 0 that renders as "0.00".
 */
import { describe, expect, it } from "vitest";
import type { Evaluation } from "~/server/tracer/types";
import { mapScore, mapStatus } from "../useTraceEvaluations";

function makeEvaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    evaluation_id: "eval-1",
    evaluator_id: "evaluator-1",
    name: "Custom check",
    status: "processed",
    passed: null,
    score: null,
    label: null,
    timestamps: {},
    ...overrides,
  } as Evaluation;
}

describe("mapStatus", () => {
  describe("when the evaluation is processed with an explicit verdict", () => {
    it("maps passed true to pass and passed false to fail", () => {
      expect(mapStatus(makeEvaluation({ passed: true }))).toBe("pass");
      expect(mapStatus(makeEvaluation({ passed: false }))).toBe("fail");
    });
  });

  describe("when the evaluation is processed without a verdict", () => {
    it("maps to the neutral processed status, not an invented pass", () => {
      expect(mapStatus(makeEvaluation({ passed: null }))).toBe("processed");
    });

    it("stays neutral even when a score is present (score-only evaluator)", () => {
      expect(mapStatus(makeEvaluation({ passed: null, score: 0.85 }))).toBe(
        "processed",
      );
    });
  });

  describe("when the evaluation did not run to completion", () => {
    it("preserves error and skipped", () => {
      expect(mapStatus(makeEvaluation({ status: "error" }))).toBe("error");
      expect(mapStatus(makeEvaluation({ status: "skipped" }))).toBe("skipped");
    });
  });
});

describe("mapScore", () => {
  describe("when the evaluation carries a numeric score", () => {
    it("returns the score", () => {
      expect(mapScore(makeEvaluation({ score: 0.42 }))).toBe(0.42);
    });
  });

  describe("when the evaluation carries only a verdict", () => {
    it("returns the boolean verdict", () => {
      expect(mapScore(makeEvaluation({ passed: true }))).toBe(true);
    });
  });

  describe("when the evaluation carries neither score nor verdict", () => {
    it("returns null instead of a fabricated 0", () => {
      expect(
        mapScore(makeEvaluation({ score: null, passed: null })),
      ).toBeNull();
    });
  });
});
