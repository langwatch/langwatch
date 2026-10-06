/**
 * An evaluator's verdict, score, label or status is about that evaluator's
 * run: `evaluator:X AND evaluatorVerdict:fail` asks "did X fail".
 * @see https://github.com/langwatch/tasks/issues/918
 */
import type {
  InMemoryTrace,
  TraceQueryEvaluationRun,
  TraceSummaryData,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { traceMatchesQuery } from "../trace-query-evaluation.rules.ts";

function makeEval(over: Partial<TraceQueryEvaluationRun>): TraceQueryEvaluationRun {
  return {
    evaluatorId: "ev1",
    evaluatorName: null,
    status: "processed",
    passed: null,
    score: null,
    label: null,
    ...over,
  };
}

function traceWith(evaluations: TraceQueryEvaluationRun[]): InMemoryTrace {
  return {
    summary: { traceId: "trace-1", attributes: {} } as TraceSummaryData,
    evaluations,
  };
}

/** X passed with a high score; Y failed with a low score and a label. */
const xPassedYFailed = traceWith([
  makeEval({
    evaluatorId: "X",
    passed: true,
    score: 0.9,
  }),
  makeEval({
    evaluatorId: "Y",
    passed: false,
    score: 0.1,
    label: "toxic",
  }),
]);

/** X failed with a low score. */
const xFailed = traceWith([
  makeEval({
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
      expect(traceMatchesQuery(query, xPassedYFailed)).toBe(false);
    });
  });

  describe("when the evaluator itself holds the result", () => {
    it.each([
      "evaluator:X AND evaluatorVerdict:fail",
      "(evaluator:X AND evaluatorVerdict:fail)",
      "evaluator:X AND evaluatorScore:<0.5",
      "evaluator:X AND NOT evaluatorVerdict:pass",
    ])("matches %s", (query) => {
      expect(traceMatchesQuery(query, xFailed)).toBe(true);
    });
  });

  describe("when the result is excluded and another evaluator holds it", () => {
    it("matches the evaluator that did not pass", () => {
      const xFailedYPassed = traceWith([
        makeEval({ evaluatorId: "X", passed: false }),
        makeEval({ evaluatorId: "Y", passed: true }),
      ]);
      expect(traceMatchesQuery("evaluator:X AND NOT evaluatorVerdict:pass", xFailedYPassed)).toBe(
        true,
      );
    });
  });

  describe("when two verdicts are picked for the evaluator", () => {
    it("matches a run holding either of them", () => {
      expect(
        traceMatchesQuery(
          "(evaluator:X AND evaluatorVerdict:pass AND evaluatorVerdict:fail)",
          xFailed,
        ),
      ).toBe(true);
    });
  });

  describe("when the pairing sits next to other conditions", () => {
    it("keeps the pairing and still applies the rest", () => {
      expect(
        traceMatchesQuery(
          "evaluator:Y AND evaluatorVerdict:fail AND evaluatorLabel:toxic",
          xPassedYFailed,
        ),
      ).toBe(true);
      expect(
        traceMatchesQuery("(evaluator:X AND evaluatorVerdict:fail) OR evaluator:Z", xPassedYFailed),
      ).toBe(false);
    });
  });

  describe("when no evaluator is named", () => {
    it("still matches a result from any evaluator", () => {
      expect(traceMatchesQuery("evaluatorVerdict:fail", xPassedYFailed)).toBe(true);
    });
  });

  describe("when two evaluators are named in one conjunction", () => {
    it.each([
      "evaluator:X AND evaluator:Y AND evaluatorVerdict:fail",
      "evaluator:Y AND evaluator:X AND evaluatorVerdict:fail",
      "evaluator:X AND evaluatorVerdict:fail AND evaluator:Y",
      "evaluatorVerdict:fail AND evaluator:X AND evaluator:Y",
    ])("ties the result to neither of them in %s", (query) => {
      expect(traceMatchesQuery(query, xPassedYFailed)).toBe(true);
    });
  });

  describe("when the evaluator ran more than once", () => {
    const xPassedThenFailed = traceWith([
      makeEval({ evaluatorId: "X", passed: true }),
      makeEval({ evaluatorId: "X", passed: false }),
    ]);

    it("matches a kept result held by any of its runs", () => {
      expect(traceMatchesQuery("evaluator:X AND evaluatorVerdict:pass", xPassedThenFailed)).toBe(
        true,
      );
    });

    it("needs one run to hold a verdict and a score together", () => {
      const failedHighPassedLow = traceWith([
        makeEval({
          evaluatorId: "X",
          passed: false,
          score: 0.9,
        }),
        makeEval({
          evaluatorId: "X",
          passed: true,
          score: 0.1,
        }),
      ]);
      expect(
        traceMatchesQuery(
          "(evaluator:X AND evaluatorVerdict:fail AND evaluatorScore:[0 TO 0.5])",
          failedHighPassedLow,
        ),
      ).toBe(false);
    });

    it("needs one run to sit inside both score bounds", () => {
      const scoredLowThenHigh = traceWith([
        makeEval({ evaluatorId: "X", score: 0.1 }),
        makeEval({ evaluatorId: "X", score: 0.9 }),
      ]);
      expect(
        traceMatchesQuery(
          "evaluator:X AND evaluatorScore:>0.05 AND evaluatorScore:<0.2",
          scoredLowThenHigh,
        ),
      ).toBe(true);
      expect(
        traceMatchesQuery(
          "evaluator:X AND evaluatorScore:>0.5 AND evaluatorScore:<0.2",
          scoredLowThenHigh,
        ),
      ).toBe(false);
    });

    it("drops the trace when any of its runs holds an excluded result", () => {
      expect(
        traceMatchesQuery("evaluator:X AND NOT evaluatorVerdict:fail", xPassedThenFailed),
      ).toBe(false);
    });
  });
});
