/**
 * Tests to ensure the execution request schema matches what the frontend sends.
 *
 * IMPORTANT: These tests prevent type duplication issues where the frontend
 * and backend schemas diverge. The executionRequestSchema MUST use shared
 * schemas from evaluations-v3/types.ts (evaluatorConfigSchema, targetConfigSchema)
 * rather than defining inline duplicates.
 */
import { describe, expect, it } from "vitest";
import { executionRequestSchema } from "../types";

describe("executionRequestSchema", () => {
  it("accepts evaluators without settings (settings are fetched from DB)", () => {
    const validRequest = {
      projectId: "project-123",
      experimentId: "exp-123",
      name: "Test Evaluation",
      dataset: {
        id: "dataset-1",
        name: "Test Dataset",
        type: "inline" as const,
        columns: [{ id: "input", name: "input", type: "string" }],
        inline: {
          columns: [{ id: "input", name: "input", type: "string" }],
          records: { input: ["Hello"] },
        },
      },
      targets: [
        {
          id: "target-1",
          type: "prompt" as const,
          name: "Test Target",
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          mappings: {},
        },
      ],
      evaluators: [
        {
          id: "eval-1",
          evaluatorType: "langevals/exact_match",
          name: "Exact Match",
          // No settings - they are fetched from DB at execution time
          inputs: [{ identifier: "output", type: "str" }],
          mappings: {},
          dbEvaluatorId: "db-eval-123",
        },
      ],
      scope: { type: "full" as const },
    };

    const result = executionRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("accepts evaluators with dbEvaluatorId", () => {
    const validRequest = {
      projectId: "project-123",
      name: "Test Evaluation",
      dataset: {
        id: "dataset-1",
        name: "Test Dataset",
        type: "inline" as const,
        columns: [{ id: "input", name: "input", type: "string" }],
        inline: {
          columns: [{ id: "input", name: "input", type: "string" }],
          records: { input: ["Hello"] },
        },
      },
      targets: [],
      evaluators: [
        {
          id: "eval-1",
          evaluatorType: "langevals/llm_score",
          name: "LLM Score",
          inputs: [],
          mappings: {},
          dbEvaluatorId: "evaluator_abc123", // This is now used to fetch settings from DB
        },
      ],
      scope: { type: "full" as const },
    };

    const result = executionRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evaluators[0]?.dbEvaluatorId).toBe("evaluator_abc123");
    }
  });

  it("still accepts deprecated settings field for backward compatibility", () => {
    const requestWithSettings = {
      projectId: "project-123",
      name: "Test Evaluation",
      dataset: {
        id: "dataset-1",
        name: "Test Dataset",
        type: "inline" as const,
        columns: [],
        inline: { columns: [], records: {} },
      },
      targets: [],
      evaluators: [
        {
          id: "eval-1",
          evaluatorType: "langevals/exact_match",
          name: "Exact Match",
          settings: { someKey: "someValue" }, // Deprecated but still accepted
          inputs: [],
          mappings: {},
        },
      ],
      scope: { type: "full" as const },
    };

    const result = executionRequestSchema.safeParse(requestWithSettings);
    expect(result.success).toBe(true);
  });

  it("validates concurrency is within bounds", () => {
    const baseRequest = {
      projectId: "project-123",
      name: "Test",
      dataset: {
        id: "d1",
        name: "D",
        type: "inline" as const,
        columns: [],
        inline: { columns: [], records: {} },
      },
      targets: [],
      evaluators: [],
      scope: { type: "full" as const },
    };

    // Valid concurrency
    expect(
      executionRequestSchema.safeParse({ ...baseRequest, concurrency: 10 })
        .success,
    ).toBe(true);

    // Min boundary
    expect(
      executionRequestSchema.safeParse({ ...baseRequest, concurrency: 1 })
        .success,
    ).toBe(true);

    // Max boundary
    expect(
      executionRequestSchema.safeParse({ ...baseRequest, concurrency: 24 })
        .success,
    ).toBe(true);

    // Below min
    expect(
      executionRequestSchema.safeParse({ ...baseRequest, concurrency: 0 })
        .success,
    ).toBe(false);

    // Above max
    expect(
      executionRequestSchema.safeParse({ ...baseRequest, concurrency: 25 })
        .success,
    ).toBe(false);
  });

  it("accepts all scope types", () => {
    const baseRequest = {
      projectId: "project-123",
      name: "Test",
      dataset: {
        id: "d1",
        name: "D",
        type: "inline" as const,
        columns: [],
        inline: { columns: [], records: {} },
      },
      targets: [],
      evaluators: [],
    };

    // Full scope
    expect(
      executionRequestSchema.safeParse({
        ...baseRequest,
        scope: { type: "full" },
      }).success,
    ).toBe(true);

    // Rows scope
    expect(
      executionRequestSchema.safeParse({
        ...baseRequest,
        scope: { type: "rows", rowIndices: [0, 1, 2] },
      }).success,
    ).toBe(true);

    // Target scope
    expect(
      executionRequestSchema.safeParse({
        ...baseRequest,
        scope: { type: "target", targetId: "target-1" },
      }).success,
    ).toBe(true);

    // Cell scope
    expect(
      executionRequestSchema.safeParse({
        ...baseRequest,
        scope: { type: "cell", targetId: "target-1", rowIndex: 0 },
      }).success,
    ).toBe(true);

    // Evaluator scope
    expect(
      executionRequestSchema.safeParse({
        ...baseRequest,
        scope: {
          type: "evaluator",
          targetId: "target-1",
          rowIndex: 0,
          evaluatorId: "eval-1",
        },
      }).success,
    ).toBe(true);
  });
});
