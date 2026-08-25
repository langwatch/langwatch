import { describe, expect, it } from "vitest";
import {
  evaluationRunDataSchema,
  traceEvaluationDataSchema,
} from "../src/evaluation";

describe("Evaluation contract", () => {
  it("accepts a portable evaluation run", () => {
    const run = evaluationRunDataSchema.parse({
      evaluationId: "evaluation_1", evaluatorId: "evaluator_1", evaluatorType: "hallucination",
      evaluatorName: null, traceId: "trace_1", isGuardrail: false, status: "processed",
      score: 0.9, passed: true, label: null, details: null, inputs: { query: "hello" },
      error: null, errorDetails: null, createdAt: 1, updatedAt: 2, LastEventOccurredAt: 2,
      archivedAt: null, scheduledAt: 1, startedAt: 1, completedAt: 2, costId: null,
    });
    expect(run.status).toBe("processed");
  });

  it("keeps per-trace presentation separate from the durable run record", () => {
    const value = traceEvaluationDataSchema.parse({
      evaluationId: "evaluation_1", evaluatorId: "evaluator_1", evaluatorType: "hallucination",
      evaluatorName: null, traceId: "trace_1", isGuardrail: false, status: "processed",
      score: 0.9, passed: true, label: null, details: null, error: null,
      timestamps: { scheduledAt: 1, startedAt: 1, completedAt: 2 },
    });
    expect(value.inputs).toBeUndefined();
  });
});
