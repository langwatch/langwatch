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

  /**
   * The dispatcher parses the payload with this schema before any page or
   * transform sees it, so what the schema refuses is what the agent is told.
   */
  describe("given an addEvaluator payload with a comparison config", () => {
    const withComparison = (evaluatorType: string) => ({
      evaluatorType,
      inputs: [],
      comparison: {
        variants: ["target-a", "target-b"],
        hasGoldenAnswer: true,
        goldenField: "expected_output",
        includeMetrics: [],
        randomizeOrder: true,
      },
    });

    describe("when the evaluator is the comparison judge", () => {
      it("accepts it", () => {
        expect(
          addEvaluatorPayloadSchema.safeParse(
            withComparison("langevals/select_best_compare"),
          ).success,
        ).toBe(true);
      });
    });

    describe("when the evaluator is any other type", () => {
      /** @scenario "Only the comparison judge can be a standalone comparison column" */
      it("refuses it on the comparison field", () => {
        const result = addEvaluatorPayloadSchema.safeParse(
          withComparison("langevals/exact_match"),
        );

        expect(result.success).toBe(false);
        expect(
          result.success
            ? []
            : result.error.issues.map((issue) => issue.path.join(".")),
        ).toContain("comparison");
      });
    });
  });

  describe("given an addEvaluator payload naming a type no evaluator has", () => {
    /** @scenario "An evaluator names a type that exists" */
    it("refuses it on the evaluatorType field", () => {
      const result = addEvaluatorPayloadSchema.safeParse({
        evaluatorType: "langevals/does_not_exist",
        inputs: [],
      });

      expect(result.success).toBe(false);
      expect(
        result.success
          ? []
          : result.error.issues.map((issue) => issue.path.join(".")),
      ).toContain("evaluatorType");
    });

    it("accepts the whole-workflow evaluator, which has no id in its type", () => {
      expect(
        addEvaluatorPayloadSchema.safeParse({
          evaluatorType: "workflow",
          inputs: [],
        }).success,
      ).toBe(true);
    });

    it("accepts a code evaluator, whose type carries a row id", () => {
      expect(
        addEvaluatorPayloadSchema.safeParse({
          evaluatorType: "code/evaluator_abc",
          inputs: [],
        }).success,
      ).toBe(true);
    });

    it("refuses a namespace prefix with no row id behind it", () => {
      expect(
        addEvaluatorPayloadSchema.safeParse({
          evaluatorType: "custom/",
          inputs: [],
        }).success,
      ).toBe(false);
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
