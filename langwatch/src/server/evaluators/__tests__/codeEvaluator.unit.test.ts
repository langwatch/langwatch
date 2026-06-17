/**
 * Unit tests for the code evaluator: config schema, checkType routing, and
 * the ephemeral entry -> code -> end DSL the engine executes.
 * See specs/evaluators/evaluator-management.feature.
 */
import { describe, expect, it } from "vitest";

import {
  buildCodeEvaluatorDsl,
  CODE_EVALUATOR_CHECK_PREFIX,
  codeEvaluatorConfigSchema,
  codeEvaluatorIdFromCheckType,
  DEFAULT_CODE_EVALUATOR_CONFIG,
  isCodeEvaluatorCheckType,
} from "../codeEvaluator";

describe("codeEvaluator", () => {
  describe("when parsing the config schema", () => {
    it("accepts the default seeded config", () => {
      expect(
        codeEvaluatorConfigSchema.safeParse(DEFAULT_CODE_EVALUATOR_CONFIG)
          .success,
      ).toBe(true);
    });

    it("rejects configs without code or fields", () => {
      expect(
        codeEvaluatorConfigSchema.safeParse({ inputs: [], outputs: [] })
          .success,
      ).toBe(false);
      expect(
        codeEvaluatorConfigSchema.safeParse({
          code: "x",
          inputs: [],
          outputs: [{ identifier: "passed", type: "bool" }],
        }).success,
      ).toBe(false);
    });
  });

  describe("when routing checkTypes", () => {
    it("recognizes and parses code checkTypes", () => {
      expect(isCodeEvaluatorCheckType("code/evaluator_abc")).toBe(true);
      expect(codeEvaluatorIdFromCheckType("code/evaluator_abc")).toBe(
        "evaluator_abc",
      );
    });

    it("ignores other checkTypes", () => {
      expect(isCodeEvaluatorCheckType("custom/wf_123")).toBe(false);
      expect(isCodeEvaluatorCheckType("workflow")).toBe(false);
      expect(isCodeEvaluatorCheckType("langevals/exact_match")).toBe(false);
      expect(codeEvaluatorIdFromCheckType("workflow")).toBeUndefined();
    });

    it("round-trips the prefix constant", () => {
      expect(`${CODE_EVALUATOR_CHECK_PREFIX}x`).toBe("code/x");
    });
  });

  /** @scenario Code evaluator executes through the engine code component */
  describe("when building the ephemeral DSL", () => {
    const dsl = buildCodeEvaluatorDsl({
      name: "My Evaluator",
      config: {
        code: "class Code: ...",
        inputs: [
          { identifier: "output", type: "str" },
          { identifier: "expected_output", type: "str" },
        ],
        outputs: [
          { identifier: "passed", type: "bool" },
          { identifier: "score", type: "float" },
        ],
      },
    });

    it("wires entry -> code -> end with one code node carrying the code", () => {
      expect(dsl.nodes.map((n) => n.type)).toEqual(["entry", "code", "end"]);

      const codeNode = dsl.nodes.find((n) => n.type === "code")!;
      const codeParam = (
        codeNode.data as {
          parameters: Array<{ identifier: string; value: unknown }>;
        }
      ).parameters.find((p) => p.identifier === "code");
      expect(codeParam?.value).toBe("class Code: ...");
    });

    it("connects every input and output with engine-format handles", () => {
      expect(dsl.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "entry",
            sourceHandle: "outputs.output",
            target: "code_evaluator",
            targetHandle: "inputs.output",
          }),
          expect.objectContaining({
            source: "code_evaluator",
            sourceHandle: "outputs.passed",
            target: "end",
            targetHandle: "inputs.passed",
          }),
        ]),
      );
      expect(dsl.edges).toHaveLength(4);
    });

    it("marks the end node as an evaluator with the output contract", () => {
      const endNode = dsl.nodes.find((n) => n.type === "end")!;
      const data = endNode.data as {
        behave_as?: string;
        inputs: Array<{ identifier: string }>;
      };
      expect(data.behave_as).toBe("evaluator");
      expect(data.inputs.map((i) => i.identifier)).toEqual(["passed", "score"]);
    });
  });
});
