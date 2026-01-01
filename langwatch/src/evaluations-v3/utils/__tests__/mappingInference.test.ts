/**
 * Unit tests for mapping inference utility.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";

import {
  findMatchingColumn,
  inferRunnerMappings,
  propagateMappingsToNewDataset,
  inferEvaluatorMappings,
  inferAllRunnerMappings,
  SEMANTIC_EQUIVALENTS,
} from "../mappingInference";
import type { DatasetColumn, DatasetReference, RunnerConfig, EvaluatorConfig } from "../../types";
import type { Field } from "~/optimization_studio/types/dsl";

// ============================================================================
// Test Data
// ============================================================================

const createTestColumn = (name: string, type: "string" | "number" | "boolean" = "string"): DatasetColumn => ({
  id: name,
  name,
  type,
});

const createTestDataset = (
  id: string,
  name: string,
  columns: DatasetColumn[]
): DatasetReference => ({
  id,
  name,
  type: "inline",
  columns,
});

const createTestRunner = (
  id: string,
  inputs: Field[],
  outputs: Field[] = [{ identifier: "output", type: "str" }],
  mappings: RunnerConfig["mappings"] = {}
): RunnerConfig => ({
  id,
  type: "prompt",
  name: `Runner ${id}`,
  inputs,
  outputs,
  mappings,
  evaluatorIds: [],
});

const createTestEvaluator = (
  id: string,
  inputs: Field[],
  mappings: EvaluatorConfig["mappings"] = {}
): EvaluatorConfig => ({
  id,
  evaluatorType: "langevals/exact_match",
  name: `Evaluator ${id}`,
  settings: {},
  inputs,
  mappings,
});

// ============================================================================
// Tests: findMatchingColumn
// ============================================================================

describe("findMatchingColumn", () => {
  it("returns exact match when column name matches field name", () => {
    const columns = [createTestColumn("input"), createTestColumn("output")];
    expect(findMatchingColumn("input", columns)).toBe("input");
    expect(findMatchingColumn("output", columns)).toBe("output");
  });

  it("returns undefined when no match found", () => {
    const columns = [createTestColumn("foo"), createTestColumn("bar")];
    expect(findMatchingColumn("question", columns)).toBeUndefined();
  });

  it("matches using semantic equivalents (input -> question)", () => {
    const columns = [createTestColumn("question"), createTestColumn("context")];
    expect(findMatchingColumn("input", columns)).toBe("question");
  });

  it("matches using semantic equivalents (question -> input)", () => {
    const columns = [createTestColumn("input"), createTestColumn("context")];
    expect(findMatchingColumn("question", columns)).toBe("input");
  });

  it("matches output -> answer", () => {
    const columns = [createTestColumn("answer"), createTestColumn("context")];
    expect(findMatchingColumn("output", columns)).toBe("answer");
  });

  it("matches output -> response", () => {
    const columns = [createTestColumn("response"), createTestColumn("context")];
    expect(findMatchingColumn("output", columns)).toBe("response");
  });

  it("matches expected_output -> ground_truth", () => {
    const columns = [createTestColumn("ground_truth"), createTestColumn("input")];
    expect(findMatchingColumn("expected_output", columns)).toBe("ground_truth");
  });

  it("matches expected -> expected_output", () => {
    const columns = [createTestColumn("expected_output"), createTestColumn("input")];
    expect(findMatchingColumn("expected", columns)).toBe("expected_output");
  });

  it("is case-insensitive for exact matches", () => {
    const columns = [createTestColumn("INPUT"), createTestColumn("Output")];
    expect(findMatchingColumn("input", columns)).toBe("INPUT");
    expect(findMatchingColumn("OUTPUT", columns)).toBe("Output");
  });

  it("exact match takes priority over semantic match", () => {
    // If both "input" and "question" exist, "input" should match "input" exactly
    const columns = [createTestColumn("input"), createTestColumn("question")];
    expect(findMatchingColumn("input", columns)).toBe("input");
    expect(findMatchingColumn("question", columns)).toBe("question");
  });
});

// ============================================================================
// Tests: inferRunnerMappings
// ============================================================================

describe("inferRunnerMappings", () => {
  it("infers mapping for exact name match", () => {
    const dataset = createTestDataset("ds-1", "Dataset 1", [
      createTestColumn("input"),
      createTestColumn("expected_output"),
    ]);
    const inputs: Field[] = [{ identifier: "input", type: "str" }];

    const mappings = inferRunnerMappings(inputs, dataset);

    expect(mappings.input).toEqual({
      type: "source",
      source: "dataset",
      sourceId: "ds-1",
      sourceField: "input",
    });
  });

  it("infers mapping for semantic equivalent", () => {
    const dataset = createTestDataset("ds-1", "Dataset 1", [
      createTestColumn("user_input"),
      createTestColumn("expected_output"),
    ]);
    const inputs: Field[] = [{ identifier: "question", type: "str" }];

    const mappings = inferRunnerMappings(inputs, dataset);

    expect(mappings.question).toEqual({
      type: "source",
      source: "dataset",
      sourceId: "ds-1",
      sourceField: "user_input",
    });
  });

  it("does not override existing mappings", () => {
    const dataset = createTestDataset("ds-1", "Dataset 1", [
      createTestColumn("input"),
    ]);
    const inputs: Field[] = [{ identifier: "input", type: "str" }];
    const existingMappings = {
      input: {
        type: "value" as const,
        value: "hardcoded",
      },
    };

    const mappings = inferRunnerMappings(inputs, dataset, existingMappings);

    expect(mappings.input).toBeUndefined(); // Should not override
  });

  it("returns empty object when no matches", () => {
    const dataset = createTestDataset("ds-1", "Dataset 1", [
      createTestColumn("foo"),
    ]);
    const inputs: Field[] = [{ identifier: "bar", type: "str" }];

    const mappings = inferRunnerMappings(inputs, dataset);

    expect(mappings).toEqual({});
  });

  it("infers multiple mappings", () => {
    const dataset = createTestDataset("ds-1", "Dataset 1", [
      createTestColumn("input"),
      createTestColumn("context"),
    ]);
    const inputs: Field[] = [
      { identifier: "input", type: "str" },
      { identifier: "context", type: "str" },
    ];

    const mappings = inferRunnerMappings(inputs, dataset);

    expect(mappings.input).toBeDefined();
    expect(mappings.context).toBeDefined();
    expect(mappings.input?.type).toBe("source");
    expect(mappings.context?.type).toBe("source");
    if (mappings.input?.type === "source") {
      expect(mappings.input.sourceField).toBe("input");
    }
    if (mappings.context?.type === "source") {
      expect(mappings.context.sourceField).toBe("context");
    }
  });
});

// ============================================================================
// Tests: propagateMappingsToNewDataset
// ============================================================================

describe("propagateMappingsToNewDataset", () => {
  it("propagates mapping to new dataset with same column", () => {
    const inputs: Field[] = [{ identifier: "question", type: "str" }];
    const existingMappings: Record<string, Record<string, import("../../types").FieldMapping>> = {
      "ds-1": {
        question: {
          type: "source",
          source: "dataset",
          sourceId: "ds-1",
          sourceField: "input",
        },
      },
    };
    const newDataset = createTestDataset("ds-2", "Dataset 2", [
      createTestColumn("input"),
      createTestColumn("output"),
    ]);

    const mappings = propagateMappingsToNewDataset(inputs, existingMappings, newDataset);

    expect(mappings.question).toEqual({
      type: "source",
      source: "dataset",
      sourceId: "ds-2",
      sourceField: "input",
    });
  });

  it("propagates using semantic equivalent when original column not found", () => {
    const inputs: Field[] = [{ identifier: "question", type: "str" }];
    const existingMappings: Record<string, Record<string, import("../../types").FieldMapping>> = {
      "ds-1": {
        question: {
          type: "source",
          source: "dataset",
          sourceId: "ds-1",
          sourceField: "input",
        },
      },
    };
    // New dataset has "user_input" instead of "input"
    const newDataset = createTestDataset("ds-2", "Dataset 2", [
      createTestColumn("user_input"),
      createTestColumn("output"),
    ]);

    const mappings = propagateMappingsToNewDataset(inputs, existingMappings, newDataset);

    expect(mappings.question).toBeDefined();
    expect(mappings.question?.type).toBe("source");
    if (mappings.question?.type === "source") {
      expect(mappings.question.sourceField).toBe("user_input");
    }
  });

  it("falls back to basic inference when no existing mapping", () => {
    const inputs: Field[] = [{ identifier: "context", type: "str" }];
    const existingMappings: Record<string, Record<string, import("../../types").FieldMapping>> = {};
    const newDataset = createTestDataset("ds-2", "Dataset 2", [
      createTestColumn("context"),
    ]);

    const mappings = propagateMappingsToNewDataset(inputs, existingMappings, newDataset);

    expect(mappings.context).toBeDefined();
    expect(mappings.context?.type).toBe("source");
    if (mappings.context?.type === "source") {
      expect(mappings.context.sourceField).toBe("context");
    }
  });

  it("returns empty when no match possible", () => {
    const inputs: Field[] = [{ identifier: "special", type: "str" }];
    const existingMappings: Record<string, Record<string, import("../../types").FieldMapping>> = {
      "ds-1": {
        special: {
          type: "source",
          source: "dataset",
          sourceId: "ds-1",
          sourceField: "unique_col",
        },
      },
    };
    const newDataset = createTestDataset("ds-2", "Dataset 2", [
      createTestColumn("foo"),
      createTestColumn("bar"),
    ]);

    const mappings = propagateMappingsToNewDataset(inputs, existingMappings, newDataset);

    expect(mappings.special).toBeUndefined();
  });
});

// ============================================================================
// Tests: inferEvaluatorMappings
// ============================================================================

describe("inferEvaluatorMappings", () => {
  it("maps evaluator input to runner output", () => {
    const dataset = createTestDataset("ds-1", "Dataset 1", [
      createTestColumn("input"),
      createTestColumn("expected_output"),
    ]);
    const runner = createTestRunner("runner-1", [{ identifier: "input", type: "str" }]);
    const evaluatorInputs: Field[] = [{ identifier: "output", type: "str" }];

    const mappings = inferEvaluatorMappings(evaluatorInputs, dataset, runner);

    expect(mappings.output).toEqual({
      type: "source",
      source: "runner",
      sourceId: "runner-1",
      sourceField: "output",
    });
  });

  it("maps evaluator input to dataset column", () => {
    const dataset = createTestDataset("ds-1", "Dataset 1", [
      createTestColumn("input"),
      createTestColumn("expected_output"),
    ]);
    const runner = createTestRunner("runner-1", [{ identifier: "input", type: "str" }]);
    const evaluatorInputs: Field[] = [{ identifier: "expected_output", type: "str" }];

    const mappings = inferEvaluatorMappings(evaluatorInputs, dataset, runner);

    expect(mappings.expected_output).toEqual({
      type: "source",
      source: "dataset",
      sourceId: "ds-1",
      sourceField: "expected_output",
    });
  });

  it("prioritizes runner output over dataset column for output field", () => {
    const dataset = createTestDataset("ds-1", "Dataset 1", [
      createTestColumn("output"), // Dataset also has "output"
      createTestColumn("expected_output"),
    ]);
    const runner = createTestRunner("runner-1", [{ identifier: "input", type: "str" }]);
    const evaluatorInputs: Field[] = [{ identifier: "output", type: "str" }];

    const mappings = inferEvaluatorMappings(evaluatorInputs, dataset, runner);

    // Should map to runner output, not dataset column
    expect(mappings.output?.type).toBe("source");
    if (mappings.output?.type === "source") {
      expect(mappings.output.source).toBe("runner");
      expect(mappings.output.sourceId).toBe("runner-1");
    }
  });

  it("uses semantic equivalents for runner outputs", () => {
    const dataset = createTestDataset("ds-1", "Dataset 1", [
      createTestColumn("input"),
    ]);
    const runner = createTestRunner("runner-1", [{ identifier: "input", type: "str" }], [
      { identifier: "answer", type: "str" }, // Runner outputs "answer" not "output"
    ]);
    const evaluatorInputs: Field[] = [{ identifier: "output", type: "str" }];

    const mappings = inferEvaluatorMappings(evaluatorInputs, dataset, runner);

    expect(mappings.output?.type).toBe("source");
    if (mappings.output?.type === "source") {
      expect(mappings.output.source).toBe("runner");
      expect(mappings.output.sourceField).toBe("answer");
    }
  });

  it("does not override existing mappings", () => {
    const dataset = createTestDataset("ds-1", "Dataset 1", [
      createTestColumn("input"),
    ]);
    const runner = createTestRunner("runner-1", [{ identifier: "input", type: "str" }]);
    const evaluatorInputs: Field[] = [{ identifier: "output", type: "str" }];
    const existingMappings = {
      output: {
        type: "value" as const,
        value: "hardcoded",
      },
    };

    const mappings = inferEvaluatorMappings(evaluatorInputs, dataset, runner, existingMappings);

    expect(mappings.output).toBeUndefined(); // Should not override
  });
});

// ============================================================================
// Tests: inferAllRunnerMappings
// ============================================================================

describe("inferAllRunnerMappings", () => {
  it("infers mappings for all datasets", () => {
    const runner = createTestRunner("runner-1", [
      { identifier: "input", type: "str" },
      { identifier: "context", type: "str" },
    ]);
    const datasets = [
      createTestDataset("ds-1", "Dataset 1", [
        createTestColumn("input"),
        createTestColumn("context"),
      ]),
      createTestDataset("ds-2", "Dataset 2", [
        createTestColumn("user_input"),
        createTestColumn("context"),
      ]),
    ];

    const mappings = inferAllRunnerMappings(runner, datasets);

    // Dataset 1
    const ds1Input = mappings["ds-1"]?.input;
    const ds1Context = mappings["ds-1"]?.context;
    expect(ds1Input?.type).toBe("source");
    expect(ds1Context?.type).toBe("source");
    if (ds1Input?.type === "source") {
      expect(ds1Input.sourceField).toBe("input");
    }
    if (ds1Context?.type === "source") {
      expect(ds1Context.sourceField).toBe("context");
    }

    // Dataset 2 (uses semantic equivalent for input)
    const ds2Input = mappings["ds-2"]?.input;
    const ds2Context = mappings["ds-2"]?.context;
    expect(ds2Input?.type).toBe("source");
    expect(ds2Context?.type).toBe("source");
    if (ds2Input?.type === "source") {
      expect(ds2Input.sourceField).toBe("user_input");
    }
    if (ds2Context?.type === "source") {
      expect(ds2Context.sourceField).toBe("context");
    }
  });

  it("preserves existing mappings", () => {
    const runner = createTestRunner(
      "runner-1",
      [{ identifier: "input", type: "str" }],
      [{ identifier: "output", type: "str" }],
      {
        "ds-1": {
          input: {
            type: "value",
            value: "hardcoded",
          },
        },
      }
    );
    const datasets = [
      createTestDataset("ds-1", "Dataset 1", [createTestColumn("input")]),
    ];

    const mappings = inferAllRunnerMappings(runner, datasets);

    // Should preserve existing value mapping
    expect(mappings["ds-1"]?.input?.type).toBe("value");
  });
});

// ============================================================================
// Tests: SEMANTIC_EQUIVALENTS coverage
// ============================================================================

describe("SEMANTIC_EQUIVALENTS coverage", () => {
  it("has expected input equivalents", () => {
    expect(SEMANTIC_EQUIVALENTS.input).toContain("question");
    expect(SEMANTIC_EQUIVALENTS.input).toContain("user_input");
    expect(SEMANTIC_EQUIVALENTS.input).toContain("query");
  });

  it("has expected output equivalents", () => {
    expect(SEMANTIC_EQUIVALENTS.output).toContain("answer");
    expect(SEMANTIC_EQUIVALENTS.output).toContain("response");
    expect(SEMANTIC_EQUIVALENTS.output).toContain("result");
  });

  it("has expected_output equivalents", () => {
    expect(SEMANTIC_EQUIVALENTS.expected_output).toContain("ground_truth");
    expect(SEMANTIC_EQUIVALENTS.expected_output).toContain("expected");
  });

  it("has bidirectional mappings", () => {
    // question maps to input, and input maps to question
    expect(SEMANTIC_EQUIVALENTS.question).toContain("input");
    expect(SEMANTIC_EQUIVALENTS.input).toContain("question");
  });
});
