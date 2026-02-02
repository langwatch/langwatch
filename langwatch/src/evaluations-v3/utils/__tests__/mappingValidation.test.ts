import { describe, expect, it } from "vitest";
import type { TargetConfig } from "../../types";
import {
  getTargetMissingMappings,
  targetHasMissingMappings,
} from "../mappingValidation";

describe("mappingValidation", () => {
  describe("evaluator target validation", () => {
    // Evaluator with:
    //   required fields: ["output", "expected_output"]
    //   optional fields: ["input"]
    const createEvaluatorTargetConfig = (
      overrides: Partial<TargetConfig> = {},
    ): TargetConfig => ({
      id: "target-eval-1",
      type: "evaluator",
      targetEvaluatorId: "eval-db-123",
      inputs: [
        { identifier: "output", type: "str" },
        { identifier: "expected_output", type: "str" },
        { identifier: "input", type: "str", optional: true },
      ],
      outputs: [
        { identifier: "passed", type: "bool" },
        { identifier: "score", type: "float" },
        { identifier: "label", type: "str" },
      ],
      mappings: {},
      ...overrides,
    });

    it("returns valid when all required fields are mapped", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {
          "dataset-1": {
            output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "response",
            },
            expected_output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "expected",
            },
          },
        },
      });

      const result = getTargetMissingMappings(target, "dataset-1");

      expect(result.isValid).toBe(true);
      expect(result.missingMappings).toHaveLength(0);
    });

    it("returns invalid when required field is not mapped", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {
          "dataset-1": {
            // Only map 'output', missing 'expected_output'
            output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "response",
            },
          },
        },
      });

      const result = getTargetMissingMappings(target, "dataset-1");

      expect(result.isValid).toBe(false);
      expect(result.missingMappings).toHaveLength(1);
      expect(result.missingMappings[0]?.fieldId).toBe("expected_output");
      expect(result.missingMappings[0]?.isRequired).toBe(true);
    });

    it("returns invalid when only optional field is mapped", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {
          "dataset-1": {
            // Only optional field mapped, both required fields missing
            input: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "question",
            },
          },
        },
      });

      const result = getTargetMissingMappings(target, "dataset-1");

      expect(result.isValid).toBe(false);
      // Should have both required fields missing
      expect(result.missingMappings).toHaveLength(2);
      expect(
        result.missingMappings.some((m) => m.fieldId === "output"),
      ).toBe(true);
      expect(
        result.missingMappings.some((m) => m.fieldId === "expected_output"),
      ).toBe(true);
    });

    it("returns valid when only optional fields are unmapped", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {
          "dataset-1": {
            // Only required fields mapped
            output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "response",
            },
            expected_output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "expected",
            },
            // 'input' is optional - not mapped
          },
        },
      });

      const result = getTargetMissingMappings(target, "dataset-1");

      expect(result.isValid).toBe(true);
      // Should not list optional fields as missing
      expect(result.missingMappings).toHaveLength(0);
    });

    it("returns invalid when no fields are mapped at all", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {},
      });

      const result = getTargetMissingMappings(target, "dataset-1");

      expect(result.isValid).toBe(false);
      // Should list both required fields as missing
      expect(
        result.missingMappings.some((m) => m.fieldId === "output"),
      ).toBe(true);
      expect(
        result.missingMappings.some((m) => m.fieldId === "expected_output"),
      ).toBe(true);
    });

    it("targetHasMissingMappings returns true for invalid target", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {},
      });

      expect(targetHasMissingMappings(target, "dataset-1")).toBe(true);
    });

    it("targetHasMissingMappings returns false for valid target", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {
          "dataset-1": {
            output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "response",
            },
            expected_output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "expected",
            },
          },
        },
      });

      expect(targetHasMissingMappings(target, "dataset-1")).toBe(false);
    });

    it("handles evaluator type with no required fields (all optional)", () => {
      // All fields are optional
      const target: TargetConfig = {
        id: "target-eval-2",
        type: "evaluator",
        targetEvaluatorId: "eval-db-456",
        inputs: [
          { identifier: "input", type: "str", optional: true },
          { identifier: "output", type: "str", optional: true },
          { identifier: "contexts", type: "str", optional: true },
        ],
        outputs: [
          { identifier: "passed", type: "bool" },
          { identifier: "score", type: "float" },
          { identifier: "label", type: "str" },
        ],
        mappings: {
          "dataset-1": {
            // Map at least one field (required for validity)
            input: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "question",
            },
          },
        },
      };

      const result = getTargetMissingMappings(target, "dataset-1");

      // Valid because there are no required fields and at least one optional is mapped
      expect(result.isValid).toBe(true);
    });

    it("returns invalid when evaluator type has no required fields but nothing is mapped", () => {
      // All fields are optional
      const target: TargetConfig = {
        id: "target-eval-2",
        type: "evaluator",
        targetEvaluatorId: "eval-db-456",
        inputs: [
          { identifier: "input", type: "str", optional: true },
          { identifier: "output", type: "str", optional: true },
          { identifier: "contexts", type: "str", optional: true },
        ],
        outputs: [
          { identifier: "passed", type: "bool" },
          { identifier: "score", type: "float" },
          { identifier: "label", type: "str" },
        ],
        mappings: {},
      };

      const result = getTargetMissingMappings(target, "dataset-1");

      // Invalid because at least one field must be mapped
      expect(result.isValid).toBe(false);
    });
  });
});
