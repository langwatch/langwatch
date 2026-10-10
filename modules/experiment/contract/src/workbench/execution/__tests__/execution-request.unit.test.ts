/**
 * Tests that the execution request schema matches what the frontend sends.
 * IMPORTANT: `executionRequestSchema` MUST use the shared schemas from
 * experiment-workbench.ts, not inline duplicates.
 */
import { describe, expect, it } from "vitest";

import { executionRequestSchema } from "../types.ts";

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
    if (!result.success) throw new Error("unreachable: asserted above");
    expect(result.data.evaluators[0]?.dbEvaluatorId).toBe("evaluator_abc123");
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
    expect(executionRequestSchema.validate({ ...baseRequest, concurrency: 10 })).toBe(true);

    // Min boundary
    expect(executionRequestSchema.validate({ ...baseRequest, concurrency: 1 })).toBe(true);

    // Max boundary
    expect(executionRequestSchema.validate({ ...baseRequest, concurrency: 24 })).toBe(true);

    // Below min
    expect(executionRequestSchema.validate({ ...baseRequest, concurrency: 0 })).toBe(false);

    // Above max
    expect(executionRequestSchema.validate({ ...baseRequest, concurrency: 25 })).toBe(false);
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
      executionRequestSchema.validate({
        ...baseRequest,
        scope: { type: "full" },
      }),
    ).toBe(true);

    // Rows scope
    expect(
      executionRequestSchema.validate({
        ...baseRequest,
        scope: { type: "rows", rowIndices: [0, 1, 2] },
      }),
    ).toBe(true);

    // Target scope
    expect(
      executionRequestSchema.validate({
        ...baseRequest,
        scope: { type: "target", targetId: "target-1" },
      }),
    ).toBe(true);

    // Target-rows scope, with and without the row subset
    expect(
      executionRequestSchema.validate({
        ...baseRequest,
        scope: {
          type: "target-rows",
          targetIds: ["target-1"],
          rowIndices: [0, 1],
        },
      }),
    ).toBe(true);
    expect(
      executionRequestSchema.validate({
        ...baseRequest,
        scope: { type: "target-rows", targetIds: ["target-1", "target-2"] },
      }),
    ).toBe(true);

    // Cell scope
    expect(
      executionRequestSchema.validate({
        ...baseRequest,
        scope: { type: "cell", targetId: "target-1", rowIndex: 0 },
      }),
    ).toBe(true);

    // Evaluator scope
    expect(
      executionRequestSchema.validate({
        ...baseRequest,
        scope: {
          type: "evaluator",
          targetId: "target-1",
          rowIndex: 0,
          evaluatorId: "eval-1",
        },
      }),
    ).toBe(true);
  });

  describe("given a request supplying both inline data and a dataset id", () => {
    describe("when the request is validated", () => {
      /** @scenario "Passing both inline data and a dataset id is rejected" */
      it("rejects the request but accepts either input on its own", () => {
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

        expect(
          executionRequestSchema.validate({
            ...baseRequest,
            data: [{ question: "a" }],
            dataset_id: "dataset-123",
          }),
        ).toBe(false);

        expect(
          executionRequestSchema.validate({
            ...baseRequest,
            data: [{ question: "a" }],
          }),
        ).toBe(true);
        expect(
          executionRequestSchema.validate({
            ...baseRequest,
            dataset_id: "dataset-123",
          }),
        ).toBe(true);
      });
    });
  });
});
