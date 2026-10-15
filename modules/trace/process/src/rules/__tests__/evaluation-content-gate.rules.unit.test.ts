import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

import { gateEvaluationContent } from "../evaluation-content-gate.rules.ts";

const run: EvaluationRunData = {
  evaluationId: "eval-1",
  evaluatorId: "monitor-1",
  evaluatorType: "langevals/basic",
  evaluatorName: "monitor",
  traceId: "trace-1",
  isGuardrail: false,
  status: "error",
  score: 0.5,
  passed: false,
  label: "off topic",
  details: "the reply to 'my card number' was off topic",
  inputs: { input: "my card number" },
  error: "could not parse 'my card number'",
  errorDetails: "at parse (evaluator.py:1)",
  createdAt: 1,
  updatedAt: 1,
  LastEventOccurredAt: 1,
  archivedAt: null,
  scheduledAt: 1,
  startedAt: 1,
  completedAt: 1,
  costId: null,
};

describe("gateEvaluationContent", () => {
  describe("when the viewer may read input and output", () => {
    it("returns the evaluation unchanged", () => {
      const protections = {
        canSeeCapturedInput: true,
        canSeeCapturedOutput: true,
      };
      expect(gateEvaluationContent({ evaluation: run, protections })).toBe(run);
    });
  });

  describe("when the viewer may read the output but not the input", () => {
    const protections = {
      canSeeCapturedInput: false,
      canSeeCapturedOutput: true,
    };

    it("hides the inputs, the details and the error text", () => {
      expect(gateEvaluationContent({ evaluation: run, protections })).toEqual({
        ...run,
        inputs: null,
        details: null,
        error: "",
        errorDetails: null,
      });
    });

    it("keeps the verdict, the score, the label and the status", () => {
      const gated = gateEvaluationContent({ evaluation: run, protections });
      expect(gated).toMatchObject({
        status: "error",
        score: 0.5,
        passed: false,
        label: "off topic",
      });
    });

    it("keeps an evaluation that had no error free of one", () => {
      const gated = gateEvaluationContent({
        evaluation: { ...run, error: null, errorDetails: null },
        protections,
      });
      expect(gated.error).toBeNull();
    });
  });

  describe("when the inputs were never read", () => {
    it("leaves them absent rather than inventing a value", () => {
      const { inputs: _inputs, ...withoutInputs } = run;
      const gated = gateEvaluationContent({
        evaluation: withoutInputs,
        protections: { canSeeCapturedInput: false },
      });
      expect("inputs" in gated).toBe(false);
    });
  });
});
