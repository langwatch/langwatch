/**
 * Regression coverage for the mapping-inference side-locking rule: "output"-like evaluator fields never fall back to a same-named dataset
 * column, and "expected_output"/"input"-like fields never fall back to a same-named target output.
 * @see specs/experiments-v3/mapping-auto-inference.feature
 */
import type { Field } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";
import { inferEvaluatorMappings } from "../mapping-inference";
import type { DatasetColumn, DatasetReference, TargetConfig } from "../types";

const createTestColumn = (name: string): DatasetColumn => ({
  id: name,
  name,
  type: "string",
});

const createTestDataset = (id: string, name: string, columns: DatasetColumn[]): DatasetReference =>
  ({ id, name, type: "inline", columns }) as DatasetReference;

const createTestTarget = (id: string, inputs: Field[], outputs: Field[]): TargetConfig =>
  ({ id, type: "prompt", inputs, outputs, mappings: {} }) as TargetConfig;

describe("inferEvaluatorMappings", () => {
  describe("when the locked side has no matching column", () => {
    /** @scenario "output" never falls back to a dataset column */
    it("leaves an `output` mapping empty rather than falling back to a same-named dataset column", () => {
      const dataset = createTestDataset("ds-1", "Dataset 1", [createTestColumn("output")]);
      const target = createTestTarget(
        "target-1",
        [{ identifier: "input", type: "str" }],
        [
          { identifier: "irrelevant", type: "str" },
          { identifier: "also_irrelevant", type: "str" },
        ],
      );
      const evaluatorInputs: Field[] = [{ identifier: "output", type: "str" }];

      const mappings = inferEvaluatorMappings(evaluatorInputs, dataset, target);

      expect(mappings.output).toBeUndefined();
    });

    /** @scenario "expected_output" never picks the runner output */
    it("leaves an `expected_output` mapping empty rather than falling back to a same-named target output", () => {
      const dataset = createTestDataset("ds-1", "Dataset 1", [createTestColumn("irrelevant")]);
      const target = createTestTarget(
        "target-1",
        [{ identifier: "input", type: "str" }],
        [{ identifier: "expected_output", type: "str" }],
      );
      const evaluatorInputs: Field[] = [{ identifier: "expected_output", type: "str" }];

      const mappings = inferEvaluatorMappings(evaluatorInputs, dataset, target);

      expect(mappings.expected_output).toBeUndefined();
    });

    /** @scenario "input" never picks the runner output */
    it("leaves an `input` mapping empty rather than falling back to a same-named target output", () => {
      const dataset = createTestDataset("ds-1", "Dataset 1", [createTestColumn("irrelevant")]);
      const target = createTestTarget(
        "target-1",
        [{ identifier: "input", type: "str" }],
        [{ identifier: "input", type: "str" }],
      );
      const evaluatorInputs: Field[] = [{ identifier: "input", type: "str" }];

      const mappings = inferEvaluatorMappings(evaluatorInputs, dataset, target);

      expect(mappings.input).toBeUndefined();
    });
  });

  describe("when the target exposes multiple outputs", () => {
    /** @scenario An output field is left for me to map when the runner has several outputs to choose from */
    it("leaves the output field unmapped", () => {
      const dataset = createTestDataset("ds-1", "Dataset 1", [createTestColumn("input")]);
      const target = createTestTarget(
        "target-1",
        [{ identifier: "input", type: "str" }],
        [
          { identifier: "category", type: "str" },
          { identifier: "confidence", type: "str" },
        ],
      );
      const evaluatorInputs: Field[] = [{ identifier: "output", type: "str" }];

      const mappings = inferEvaluatorMappings(evaluatorInputs, dataset, target);

      expect(mappings.output).toBeUndefined();
    });
  });
});
