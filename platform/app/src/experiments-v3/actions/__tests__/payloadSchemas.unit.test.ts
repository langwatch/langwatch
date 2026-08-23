import { describe, expect, it } from "vitest";
import {
  addColumnPayloadSchema,
  addEvaluatorPayloadSchema,
  addRowsPayloadSchema,
  addTargetPayloadSchema,
  duplicateTargetPayloadSchema,
  removeTargetPayloadSchema,
  setCellValuePayloadSchema,
  setEvaluatorMappingPayloadSchema,
  setMappingPayloadSchema,
  setTargetPromptPayloadSchema,
  updateTargetModelPayloadSchema,
} from "../schemas";

describe("payload schemas", () => {
  const fixtures = [
    {
      kind: "duplicateTarget",
      schema: duplicateTargetPayloadSchema,
      payload: { targetId: "target-a", name: "copy" },
    },
    {
      kind: "setTargetPrompt",
      schema: setTargetPromptPayloadSchema,
      payload: {
        targetId: "target-a",
        localPromptConfig: {
          llm: { model: "openai/gpt-5-mini" },
          messages: [{ role: "user", content: "hi" }],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
        },
      },
    },
    {
      kind: "updateTargetModel",
      schema: updateTargetModelPayloadSchema,
      payload: { targetId: "target-a", model: "openai/gpt-5-mini" },
    },
    {
      kind: "setMapping",
      schema: setMappingPayloadSchema,
      payload: {
        targetId: "target-a",
        datasetId: "ds-1",
        inputField: "input",
        mapping: {
          type: "source",
          source: "dataset",
          sourceId: "ds-1",
          sourceField: "input",
        },
      },
    },
    {
      kind: "setEvaluatorMapping",
      schema: setEvaluatorMappingPayloadSchema,
      payload: {
        evaluatorId: "evaluator_1",
        datasetId: "ds-1",
        targetId: "target-a",
        inputField: "output",
        mapping: { type: "value", value: "x" },
      },
    },
    {
      kind: "addEvaluator",
      schema: addEvaluatorPayloadSchema,
      payload: {
        evaluatorType: "langevals/exact_match",
        inputs: [{ identifier: "output", type: "str" }],
      },
    },
    {
      kind: "addTarget",
      schema: addTargetPayloadSchema,
      payload: {
        type: "prompt",
        promptId: "prompt-1",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      },
    },
    {
      kind: "setCellValue",
      schema: setCellValuePayloadSchema,
      payload: {
        datasetId: "ds-1",
        rowIndex: 0,
        columnId: "input",
        value: "x",
      },
    },
    {
      kind: "addColumn",
      schema: addColumnPayloadSchema,
      payload: { datasetId: "ds-1", column: { name: "context" } },
    },
    {
      kind: "addRows",
      schema: addRowsPayloadSchema,
      payload: { datasetId: "ds-1", rows: [{ input: "x" }] },
    },
    {
      kind: "removeTarget",
      schema: removeTargetPayloadSchema,
      payload: { targetId: "target-a" },
    },
  ];

  describe("given a payload an action would really be called with", () => {
    describe("when its own schema parses it", () => {
      it.each(fixtures)("accepts the $kind fixture", ({ schema, payload }) => {
        expect(schema.safeParse(payload).success).toBe(true);
      });
    });
  });

  describe("when a generated id is given as a blank string", () => {
    it("rejects it on addTarget and on addEvaluator", () => {
      expect(
        addTargetPayloadSchema.safeParse({
          id: "",
          type: "prompt",
          promptId: "prompt-1",
          inputs: [],
          outputs: [],
          mappings: {},
        }).success,
      ).toBe(false);
      expect(
        addEvaluatorPayloadSchema.safeParse({
          id: "",
          evaluatorType: "langevals/exact_match",
          inputs: [],
        }).success,
      ).toBe(false);
    });
  });
});
