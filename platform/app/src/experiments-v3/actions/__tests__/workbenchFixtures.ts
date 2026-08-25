import type {
  DatasetReference,
  EvaluatorConfig,
  TargetConfig,
} from "../../types";
import { TransformError, type WorkbenchState } from "../transforms";

/**
 * The workbench every transform suite starts from: one inline dataset, one
 * prompt target and one evaluator wired to it. Each builder returns a fresh
 * object so a test that mutates state cannot leak into the next one.
 */

export const inlineDataset = (): DatasetReference => ({
  id: "ds-1",
  name: "Test Data",
  type: "inline",
  columns: [
    { id: "input", name: "input", type: "string" },
    { id: "expected_output", name: "expected_output", type: "string" },
  ],
  inline: {
    columns: [
      { id: "input", name: "input", type: "string" },
      { id: "expected_output", name: "expected_output", type: "string" },
    ],
    records: {
      input: ["first question", "second question"],
      expected_output: ["first answer", "second answer"],
    },
  },
});

export const secondInlineDataset = (): DatasetReference => ({
  id: "ds-2",
  name: "Other Data",
  type: "inline",
  columns: [{ id: "question", name: "question", type: "string" }],
  inline: {
    columns: [{ id: "question", name: "question", type: "string" }],
    records: { question: ["first question"] },
  },
});

export const savedDataset = (): DatasetReference => ({
  id: "ds-saved",
  name: "Saved Data",
  type: "saved",
  datasetId: "db-dataset-1",
  columns: [{ id: "input", name: "input", type: "string" }],
  savedRecords: [{ id: "rec-1", input: "first question" }],
});

export const promptTarget = (): TargetConfig => ({
  id: "target-a",
  type: "prompt",
  promptId: "prompt-1",
  promptVersionNumber: 3,
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {
    "ds-1": {
      input: {
        type: "source",
        source: "dataset",
        sourceId: "ds-1",
        sourceField: "input",
      },
    },
  },
});

export const evaluator = (): EvaluatorConfig => ({
  id: "evaluator_1",
  evaluatorType: "langevals/llm_answer_match",
  dbEvaluatorId: "db-evaluator-1",
  inputs: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
    // A field no heuristic can infer: only an explicit copy carries it over.
    { identifier: "rubric", type: "str" },
  ],
  mappings: {
    "ds-1": {
      "target-a": {
        output: {
          type: "source",
          source: "target",
          sourceId: "target-a",
          sourceField: "output",
        },
        expected_output: {
          type: "source",
          source: "dataset",
          sourceId: "ds-1",
          sourceField: "expected_output",
        },
        rubric: { type: "value", value: "be concise" },
      },
    },
  },
});

export const baseState = (): WorkbenchState => ({
  name: "My Evaluation",
  activeDatasetId: "ds-1",
  datasets: [inlineDataset()],
  targets: [promptTarget()],
  evaluators: [evaluator()],
});

/**
 * The refusal code a transform threw, so a test reads as "this input is
 * refused with this code" rather than as error plumbing.
 */
export const refusalCode = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof TransformError) return error.code;
    throw error;
  }
  throw new Error("expected the transform to refuse, it did not");
};
