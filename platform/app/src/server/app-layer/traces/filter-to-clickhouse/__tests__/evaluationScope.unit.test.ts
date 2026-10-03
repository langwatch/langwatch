/**
 * An evaluator's verdict, score, label or status is about that evaluator's
 * run. `evaluator:X AND evaluatorVerdict:fail` asks "did X fail", and the
 * in-memory matcher automations use must answer that question, not "did X run
 * and did anything fail".
 *
 * @see https://github.com/langwatch/tasks/issues/918
 */
import { describe, expect, it } from "vitest";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "../../types";
import { evaluateQueryInMemory } from "../evaluate";
import type { InMemoryTrace } from "../field-def";

function makeEval(over: Partial<EvaluationRunData>): EvaluationRunData {
  return {
    evaluationId: "e1",
    evaluatorId: "ev1",
    evaluatorType: "custom",
    evaluatorName: null,
    traceId: "trace-1",
    isGuardrail: false,
    status: "processed",
    score: null,
    passed: null,
    label: null,
    details: null,
    inputs: null,
    error: null,
    errorDetails: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    costId: null,
    ...over,
  } as EvaluationRunData;
}

function traceWith(evaluations: EvaluationRunData[]): InMemoryTrace {
  return {
    summary: { traceId: "trace-1", attributes: {} } as TraceSummaryData,
    evaluations,
  };
}

/** X passed with a high score; Y failed with a low score and a label. */
const xPassedYFailed = traceWith([
  makeEval({
    evaluationId: "e-x",
    evaluatorId: "X",
    passed: true,
    score: 0.9,
  }),
  makeEval({
    evaluationId: "e-y",
    evaluatorId: "Y",
    passed: false,
    score: 0.1,
    label: "toxic",
  }),
]);

/** X failed with a low score. */
const xFailed = traceWith([
  makeEval({
    evaluationId: "e-x",
    evaluatorId: "X",
    passed: false,
    score: 0.1,
  }),
]);

describe("an evaluator paired with its own result", () => {
  describe("when another evaluator holds the result asked for", () => {
    it.each([
      "evaluator:X AND evaluatorVerdict:fail",
      "(evaluator:X AND evaluatorVerdict:fail)",
      "evaluatorVerdict:fail AND evaluator:X",
      "evaluator:X AND evaluatorPassed:fail",
      "evaluator:X AND evaluatorScore:<0.5",
      "evaluator:X AND evaluatorLabel:toxic",
      "evaluator:X AND NOT evaluatorVerdict:pass",
    ])("does not match %s", (query) => {
      expect(evaluateQueryInMemory(query, xPassedYFailed)).toBe(false);
    });
  });

  describe("when the evaluator itself holds the result", () => {
    it.each([
      "evaluator:X AND evaluatorVerdict:fail",
      "(evaluator:X AND evaluatorVerdict:fail)",
      "evaluator:X AND evaluatorScore:<0.5",
      "evaluator:X AND NOT evaluatorVerdict:pass",
    ])("matches %s", (query) => {
      expect(evaluateQueryInMemory(query, xFailed)).toBe(true);
    });
  });

  describe("when the result is excluded and another evaluator holds it", () => {
    it("matches the evaluator that did not pass", () => {
      const xFailedYPassed = traceWith([
        makeEval({ evaluationId: "e-x", evaluatorId: "X", passed: false }),
        makeEval({ evaluationId: "e-y", evaluatorId: "Y", passed: true }),
      ]);
      expect(
        evaluateQueryInMemory(
          "evaluator:X AND NOT evaluatorVerdict:pass",
          xFailedYPassed,
        ),
      ).toBe(true);
    });
  });

  describe("when the pairing sits next to other conditions", () => {
    it("keeps the pairing and still applies the rest", () => {
      expect(
        evaluateQueryInMemory(
          "evaluator:Y AND evaluatorVerdict:fail AND evaluatorLabel:toxic",
          xPassedYFailed,
        ),
      ).toBe(true);
      expect(
        evaluateQueryInMemory(
          "(evaluator:X AND evaluatorVerdict:fail) OR evaluator:Z",
          xPassedYFailed,
        ),
      ).toBe(false);
    });
  });

  describe("when no evaluator is named", () => {
    it("still matches a result from any evaluator", () => {
      expect(
        evaluateQueryInMemory("evaluatorVerdict:fail", xPassedYFailed),
      ).toBe(true);
    });
  });

  describe("when two evaluators are named in one conjunction", () => {
    it.each([
      "evaluator:X AND evaluator:Y AND evaluatorVerdict:fail",
      "evaluator:Y AND evaluator:X AND evaluatorVerdict:fail",
      "evaluator:X AND evaluatorVerdict:fail AND evaluator:Y",
      "evaluatorVerdict:fail AND evaluator:X AND evaluator:Y",
    ])("ties the result to neither of them in %s", (query) => {
      expect(evaluateQueryInMemory(query, xPassedYFailed)).toBe(true);
    });
  });

  describe("when the evaluator ran more than once", () => {
    const xPassedThenFailed = traceWith([
      makeEval({ evaluationId: "e-x1", evaluatorId: "X", passed: true }),
      makeEval({ evaluationId: "e-x2", evaluatorId: "X", passed: false }),
    ]);

    it("matches a kept result held by any of its runs", () => {
      expect(
        evaluateQueryInMemory(
          "evaluator:X AND evaluatorVerdict:pass",
          xPassedThenFailed,
        ),
      ).toBe(true);
    });

    it("drops the trace when any of its runs holds an excluded result", () => {
      expect(
        evaluateQueryInMemory(
          "evaluator:X AND NOT evaluatorVerdict:fail",
          xPassedThenFailed,
        ),
      ).toBe(false);
    });
  });
});
