/**
 * An empty dataset column is a column; a mapping to a column the dataset does
 * not have is reported as a missing column, distinct from an unmapped field.
 * @see specs/experiments-v3/mapping-validation.feature
 */
import { describe, expect, it } from "vitest";

import type { EvaluatorConfig, TargetConfig } from "../../experiment-workbench.ts";
import {
  type DatasetColumnsReference,
  evaluatorMappingGaps,
  getTargetMissingMappings,
  validateWorkbench,
} from "../mapping-validation.ts";

const DATASET_ID = "dataset-1";

const environmentMapping = {
  [DATASET_ID]: {
    environment: {
      type: "source" as const,
      source: "dataset" as const,
      sourceId: DATASET_ID,
      sourceField: "environment",
    },
  },
};

const codeTarget = (): TargetConfig => ({
  id: "target-code",
  type: "agent",
  agentType: "code",
  inputs: [{ identifier: "environment", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: environmentMapping,
});

const connectedTarget = (): TargetConfig => ({
  id: "target-connected",
  type: "agent",
  agentType: "connected",
  inputs: [
    { identifier: "input", type: "str" },
    { identifier: "plan", type: "str", optional: true },
  ],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {
    [DATASET_ID]: {
      input: { type: "source", source: "dataset", sourceId: DATASET_ID, sourceField: "input" },
      plan: {
        type: "source",
        source: "dataset",
        sourceId: DATASET_ID,
        sourceField: "environment",
      },
    },
  },
});

const datasetsWith = (...names: string[]): DatasetColumnsReference[] => [
  { id: DATASET_ID, columns: names.map((name) => ({ name })) },
];

describe("given a runner mapped to a dataset column", () => {
  describe("when the column exists but no row has a value in it", () => {
    /** @scenario "A mapping to a column that is empty in every row is valid" */
    it("reports nothing missing", () => {
      const result = getTargetMissingMappings(codeTarget(), DATASET_ID, {
        datasets: datasetsWith("input", "environment"),
      });

      expect(result).toEqual({ isValid: true, missingMappings: [] });
    });
  });

  describe("when the active dataset has no such column", () => {
    /** @scenario "A mapping to a column the dataset does not have is reported as a missing column" */
    it("reports the field as mapped to a column that is not in the dataset", () => {
      const result = getTargetMissingMappings(codeTarget(), DATASET_ID, {
        datasets: datasetsWith("input"),
      });

      expect(result.isValid).toBe(false);
      expect(result.missingMappings).toEqual([
        {
          fieldId: "environment",
          fieldName: "environment",
          isRequired: true,
          reason: "column_not_in_dataset",
          columnName: "environment",
        },
      ]);
    });

    /** @scenario "A mapping to a column the dataset does not have is reported as a missing column" */
    it("stops the workbench run at that runner", () => {
      const target = codeTarget();
      const result = validateWorkbench({
        targets: [target],
        evaluators: [],
        activeDatasetId: DATASET_ID,
        datasets: datasetsWith("input"),
      });

      expect(result.firstInvalidTarget?.target.id).toBe(target.id);
    });

    /** @scenario "A mapping to a column the dataset does not have is reported as a missing column" */
    it("checks no column when the dataset's columns are not known", () => {
      const result = getTargetMissingMappings(codeTarget(), DATASET_ID, {
        datasets: [],
      });

      expect(result.isValid).toBe(true);
    });
  });
});

describe("given a connected agent whose optional parameter reads a missing column", () => {
  /** @scenario "A connected agent parameter mapped to a missing column is reported without blocking" */
  it("reports the column without blocking the run", () => {
    const result = getTargetMissingMappings(connectedTarget(), DATASET_ID, {
      datasets: datasetsWith("input"),
    });

    expect(result.isValid).toBe(true);
    expect(result.missingMappings).toEqual([
      {
        fieldId: "plan",
        fieldName: "plan",
        isRequired: false,
        reason: "column_not_in_dataset",
        columnName: "environment",
      },
    ]);
  });
});

describe("given an evaluator whose field reads a column the dataset does not have", () => {
  const evaluator = (): EvaluatorConfig => ({
    id: "evaluator-1",
    evaluatorType: "langevals/exact_match",
    inputs: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    mappings: {
      [DATASET_ID]: {
        "target-code": {
          output: {
            type: "source",
            source: "target",
            sourceId: "target-code",
            sourceField: "output",
          },
          expected_output: {
            type: "source",
            source: "dataset",
            sourceId: DATASET_ID,
            sourceField: "golden",
          },
        },
      },
    },
  });

  /** @scenario "An evaluator mapping to a column the dataset does not have is reported as a missing column" */
  it("reports the field as mapped to a column that is not in the dataset", () => {
    const result = evaluatorMappingGaps({
      evaluator: evaluator(),
      datasetId: DATASET_ID,
      targetId: "target-code",
      datasets: datasetsWith("input", "environment"),
    });

    expect(result.isValid).toBe(false);
    expect(result.missingMappings).toEqual([
      {
        fieldId: "expected_output",
        fieldName: "expected_output",
        isRequired: true,
        reason: "column_not_in_dataset",
        columnName: "golden",
      },
    ]);
  });

  /** @scenario "An evaluator mapping to a column the dataset does not have is reported as a missing column" */
  it("stops the workbench run at that evaluator", () => {
    const result = validateWorkbench({
      targets: [codeTarget()],
      evaluators: [evaluator()],
      activeDatasetId: DATASET_ID,
      datasets: datasetsWith("input", "environment"),
    });

    expect(result.firstInvalidEvaluator?.evaluator.id).toBe("evaluator-1");
  });
});
