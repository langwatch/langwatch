/**
 * @see modules/trace/specs/trace-evaluation-runs-read.feature
 */
import type { TraceEvaluationData } from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

import { mapTraceEvaluationsToLegacyEvaluations } from "../trace-evaluation-mapping.rules.ts";

const BASE: TraceEvaluationData = {
  evaluationId: "eval-1",
  evaluatorId: "customeval_tone",
  evaluatorType: "custom",
  evaluatorName: "Tone",
  traceId: "trace-1",
  isGuardrail: false,
  status: "scheduled",
  score: null,
  passed: null,
  label: null,
  details: null,
  error: null,
  inputs: null,
  timestamps: { scheduledAt: 1_000, startedAt: null, completedAt: null },
};

describe("given an evaluation run with failed attempts, a last error and a next attempt time", () => {
  describe("when the run is mapped to the trace's evaluation", () => {
    /** @scenario "A run's attempts reach the trace's evaluation" */
    it("carries the attempts, last error and both attempt times", () => {
      const [evaluation] = mapTraceEvaluationsToLegacyEvaluations({
        "trace-1": [
          {
            ...BASE,
            attempts: 2,
            lastAttemptError: "evaluator unavailable",
            lastAttemptAt: 2_000,
            nextAttemptAt: 3_000,
          },
        ],
      })["trace-1"]!;

      expect(evaluation).toMatchObject({
        attempts: 2,
        last_attempt_error: "evaluator unavailable",
        timestamps: { last_attempt_at: 2_000, next_attempt_at: 3_000 },
      });
    });

    /** @scenario "A run's attempts reach the trace's evaluation" */
    it("carries none of them for a run with no attempts", () => {
      const [evaluation] = mapTraceEvaluationsToLegacyEvaluations({
        "trace-1": [{ ...BASE, attempts: 0, lastAttemptError: null, nextAttemptAt: null }],
      })["trace-1"]!;

      expect(evaluation).not.toHaveProperty("attempts");
      expect(evaluation?.timestamps).not.toHaveProperty("next_attempt_at");
    });
  });
});
