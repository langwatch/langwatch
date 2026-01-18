import { describe, expect, it } from "vitest";
import type { EvaluatorConfig } from "~/evaluations-v3/types";
import type { ExecutionCell } from "../types";
import { buildEvaluatorNode } from "../workflowBuilder";

describe("buildEvaluatorNode", () => {
  const createBasicEvaluatorConfig = (): EvaluatorConfig => ({
    id: "eval-1",
    evaluatorType: "langevals/exact_match",
    name: "Exact Match",
    inputs: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    mappings: {
      "dataset-1": {
        "target-1": {
          output: {
            type: "source",
            source: "target",
            sourceId: "target-1",
            sourceField: "output",
          },
          expected_output: {
            type: "source",
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "expected",
          },
        },
      },
    },
  });

  const createBasicCell = (): ExecutionCell => ({
    rowIndex: 0,
    targetId: "target-1",
    targetConfig: {
      id: "target-1",
      type: "prompt",
      name: "Test Target",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {},
    },
    evaluatorConfigs: [],
    datasetEntry: {
      _datasetId: "dataset-1",
      input: "test input",
      expected: "expected output",
    },
  });

  it("converts custom evaluator settings to parameters format", () => {
    const evaluator: EvaluatorConfig = {
      ...createBasicEvaluatorConfig(),
      evaluatorType: "langevals/llm_score",
      name: "Custom LLM Score",
    };
    const cell = createBasicCell();

    // Settings are passed from DB (6th parameter)
    const settings = {
      model: "openai/gpt-4o-mini",
      prompt: "Custom prompt for evaluation",
      max_tokens: 100,
    };

    const node = buildEvaluatorNode(
      evaluator,
      "target-1.eval-1",
      "target-1",
      cell,
      0,
      settings,
    );

    // Settings should be in parameters array (format expected by langwatch_nlp)
    const parameters = (node.data as Record<string, unknown>)
      .parameters as Array<{ identifier: string; type: string; value: unknown }>;
    expect(parameters).toBeDefined();
    expect(parameters.length).toBe(3);

    const modelParam = parameters.find((p) => p.identifier === "model");
    expect(modelParam?.value).toBe("openai/gpt-4o-mini");

    const promptParam = parameters.find((p) => p.identifier === "prompt");
    expect(promptParam?.value).toBe("Custom prompt for evaluation");

    const maxTokensParam = parameters.find(
      (p) => p.identifier === "max_tokens",
    );
    expect(maxTokensParam?.value).toBe(100);

    // Should still have required fields
    expect(node.data.evaluator).toBe("langevals/llm_score");
    expect(node.data.name).toBe("Custom LLM Score");
  });

  it("handles empty settings with empty parameters array", () => {
    const evaluator = createBasicEvaluatorConfig();
    const cell = createBasicCell();

    // No settings passed (defaults to empty)
    const node = buildEvaluatorNode(
      evaluator,
      "target-1.eval-1",
      "target-1",
      cell,
      0,
    );

    // Should have empty parameters array when no settings
    const parameters = (node.data as Record<string, unknown>)
      .parameters as Array<{ identifier: string; type: string; value: unknown }>;
    expect(parameters).toEqual([]);

    // Should still have required fields
    expect(node.data.evaluator).toBe("langevals/exact_match");
    expect(node.data.name).toBe("Exact Match");
    expect(node.data.inputs).toHaveLength(2);
  });

  it("sets evaluator type correctly", () => {
    const evaluator = createBasicEvaluatorConfig();
    const cell = createBasicCell();

    const node = buildEvaluatorNode(
      evaluator,
      "target-1.eval-1",
      "target-1",
      cell,
      0,
    );

    expect(node.data.evaluator).toBe("langevals/exact_match");
  });

  it("sets standard evaluator outputs", () => {
    const evaluator = createBasicEvaluatorConfig();
    const cell = createBasicCell();

    const node = buildEvaluatorNode(
      evaluator,
      "target-1.eval-1",
      "target-1",
      cell,
      0,
    );

    expect(node.data.outputs?.map((o) => o.identifier)).toEqual([
      "passed",
      "score",
      "label",
    ]);
  });
});
