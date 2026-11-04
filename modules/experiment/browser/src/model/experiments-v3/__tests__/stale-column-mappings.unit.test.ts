/**
 * Column edits keep target and evaluator mappings in step with the dataset.
 * @see specs/experiments-v3/mapping-validation.feature
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useEvaluationsV3Store } from "../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import type { EvaluatorConfig, FieldMapping, TargetConfig } from "../types.ts";
const DATASET_ID = "dataset-env";

const column = (name: string): FieldMapping => ({
  type: "source",
  source: "dataset",
  sourceId: DATASET_ID,
  sourceField: name,
});

const target: TargetConfig = {
  id: "target-1",
  type: "agent",
  agentType: "code",
  inputs: [
    { identifier: "input", type: "str" },
    { identifier: "environment", type: "str" },
  ],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {
    [DATASET_ID]: { input: column("input"), environment: column("environment") },
  },
};

const evaluator: EvaluatorConfig = {
  id: "evaluator-1",
  evaluatorType: "langevals/exact_match",
  inputs: [
    { identifier: "output", type: "str" },
    { identifier: "expected_output", type: "str" },
  ],
  mappings: {
    [DATASET_ID]: {
      "target-1": {
        output: { type: "source", source: "target", sourceId: "target-1", sourceField: "output" },
        expected_output: column("environment"),
      },
    },
  },
};

const store = () => useEvaluationsV3Store.getState();
const targetMappings = () => store().targets[0]?.mappings[DATASET_ID];
const evaluatorMappings = () => store().evaluators[0]?.mappings[DATASET_ID]?.["target-1"];

beforeEach(() => {
  store().reset();
  store().addDataset({
    id: DATASET_ID,
    name: "Test Data",
    type: "inline",
    columns: [
      { id: "input_0", name: "input", type: "string" },
      { id: "environment_1", name: "environment", type: "string" },
    ],
    inline: {
      columns: [
        { id: "input_0", name: "input", type: "string" },
        { id: "environment_1", name: "environment", type: "string" },
      ],
      records: { input_0: ["hi"], environment_1: [""] },
    },
  });
  store().addTarget(target);
  store().addEvaluator(evaluator);
});

afterEach(() => store().reset());

describe("given a runner and an evaluator mapped to a dataset column", () => {
  describe("when the column is deleted", () => {
    /** @scenario "Deleting a dataset column removes the mappings that read it" */
    it("removes the mappings to it and keeps the others", () => {
      store().removeColumn(DATASET_ID, "environment_1");

      expect(targetMappings()).toEqual({ input: column("input") });
      expect(evaluatorMappings()).not.toHaveProperty("expected_output");
      expect(evaluatorMappings()).toHaveProperty("output");
    });
  });

  describe("when the column is renamed", () => {
    /** @scenario "Renaming a dataset column keeps the mappings that read it" */
    it("maps those fields to the new name", () => {
      store().renameColumn(DATASET_ID, "environment_1", "env");

      expect(targetMappings()?.environment).toEqual(column("env"));
      expect(evaluatorMappings()?.expected_output).toEqual(column("env"));
      expect(targetMappings()?.input).toEqual(column("input"));
    });
  });

  describe("when the columns editor saves the dataset without the column", () => {
    /** @scenario "Removing a column in the columns editor removes the mappings that read it" */
    it("removes the runner's mapping to it", () => {
      store().updateDataset(DATASET_ID, {
        columns: [{ id: "input_0", name: "input", type: "string" }],
      });
      store().removeMappingsToMissingColumns({ datasetId: DATASET_ID });

      expect(targetMappings()).toEqual({ input: column("input") });
    });
  });
});
