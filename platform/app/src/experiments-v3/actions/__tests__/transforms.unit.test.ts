import { describe, expect, it } from "vitest";
import type {
  DatasetReference,
  EvaluatorConfig,
  TargetConfig,
} from "../../types";
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
import {
  addColumn,
  addEvaluator,
  addRows,
  addTarget,
  duplicateTarget,
  removeTarget,
  setCellValue,
  setEvaluatorMapping,
  setTargetMapping,
  setTargetPrompt,
  TransformError,
  updateTargetModel,
  type WorkbenchState,
} from "../transforms";

const inlineDataset = (): DatasetReference => ({
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

const savedDataset = (): DatasetReference => ({
  id: "ds-saved",
  name: "Saved Data",
  type: "saved",
  datasetId: "db-dataset-1",
  columns: [{ id: "input", name: "input", type: "string" }],
  savedRecords: [{ id: "rec-1", input: "first question" }],
});

const promptTarget = (): TargetConfig => ({
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

const evaluator = (): EvaluatorConfig => ({
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

const baseState = (): WorkbenchState => ({
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
const refusalCode = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof TransformError) return error.code;
    throw error;
  }
  throw new Error("expected the transform to refuse, it did not");
};

describe("workbench transforms", () => {
  describe("duplicateTarget", () => {
    describe("given a target with mappings and an evaluator wired to it", () => {
      it("adds a copy under a new target id", () => {
        const { state, result } = duplicateTarget({
          state: baseState(),
          payload: { targetId: "target-a" },
        });

        expect(state.targets).toHaveLength(2);
        expect(result?.targetId).toMatch(/^target-[\w-]{8}$/);
        expect(result?.targetId).not.toBe("target-a");
        const copy = state.targets[1]!;
        expect(copy.promptId).toBe("prompt-1");
        expect(copy.promptVersionNumber).toBe(3);
      });

      it("copies the target's own dataset mappings", () => {
        const { state } = duplicateTarget({
          state: baseState(),
          payload: { targetId: "target-a" },
        });

        expect(state.targets[1]!.mappings["ds-1"]!.input).toEqual({
          type: "source",
          source: "dataset",
          sourceId: "ds-1",
          sourceField: "input",
        });
      });

      /** @scenario "A duplicated target keeps the wiring of the target it came from" */
      it("copies every evaluator mapping bucket onto the copy", () => {
        const { state, result } = duplicateTarget({
          state: baseState(),
          payload: { targetId: "target-a" },
        });

        const copied =
          state.evaluators[0]!.mappings["ds-1"]![result!.targetId]!;
        expect(Object.keys(copied).sort()).toEqual([
          "expected_output",
          "output",
          "rubric",
        ]);
        // The one no heuristic could re-infer.
        expect(copied.rubric).toEqual({ type: "value", value: "be concise" });
      });

      /** @scenario "A duplicated target is graded on its own output" */
      it("repoints an output mapping at the copy, not at the source column", () => {
        const { state, result } = duplicateTarget({
          state: baseState(),
          payload: { targetId: "target-a" },
        });

        expect(
          state.evaluators[0]!.mappings["ds-1"]![result!.targetId]!.output,
        ).toEqual({
          type: "source",
          source: "target",
          sourceId: result!.targetId,
          sourceField: "output",
        });
      });

      it("leaves the source target's mappings untouched", () => {
        const before = baseState();
        const { state } = duplicateTarget({
          state: before,
          payload: { targetId: "target-a" },
        });

        expect(state.evaluators[0]!.mappings["ds-1"]!["target-a"]).toEqual(
          evaluator().mappings["ds-1"]!["target-a"],
        );
        expect(before.targets).toHaveLength(1);
      });
    });

    describe("when the target is an evaluator target", () => {
      it("applies the name override to its local config", () => {
        const state = baseState();
        state.targets = [
          {
            id: "target-eval",
            type: "evaluator",
            targetEvaluatorId: "db-evaluator-2",
            localEvaluatorConfig: { name: "Judge" },
            inputs: [],
            outputs: [],
            mappings: {},
          },
        ];

        const { state: next, result } = duplicateTarget({
          state,
          payload: { targetId: "target-eval", name: "Judge copy" },
        });

        expect(next.targets[1]!.localEvaluatorConfig?.name).toBe("Judge copy");
        expect(result?.name).toBe("Judge copy");
      });
    });

    describe("when the target takes its name from a prompt", () => {
      it("reports the name as unapplied", () => {
        const { result } = duplicateTarget({
          state: baseState(),
          payload: { targetId: "target-a", name: "Ignored" },
        });

        expect(result?.name).toBeUndefined();
      });
    });

    describe("when the target does not exist", () => {
      it("refuses with target_not_found", () => {
        expect(
          refusalCode(() =>
            duplicateTarget({
              state: baseState(),
              payload: { targetId: "nope" },
            }),
          ),
        ).toBe("target_not_found");
      });
    });
  });

  describe("addTarget", () => {
    it("infers dataset mappings and evaluator mappings for the new target", () => {
      const { state, result } = addTarget({
        state: baseState(),
        payload: {
          type: "prompt",
          promptId: "prompt-2",
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          mappings: {},
        },
      });

      const added = state.targets[1]!;
      expect(added.id).toBe(result?.targetId);
      expect(added.mappings["ds-1"]!.input).toEqual({
        type: "source",
        source: "dataset",
        sourceId: "ds-1",
        sourceField: "input",
      });
      expect(state.evaluators[0]!.mappings["ds-1"]![added.id]!.output).toEqual({
        type: "source",
        source: "target",
        sourceId: added.id,
        sourceField: "output",
      });
    });

    it("keeps a mapping given on the payload", () => {
      const { state } = addTarget({
        state: baseState(),
        payload: {
          id: "target-b",
          type: "prompt",
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [],
          mappings: {
            "ds-1": { input: { type: "value", value: "fixed" } },
          },
        },
      });

      expect(state.targets[1]!.mappings["ds-1"]!.input).toEqual({
        type: "value",
        value: "fixed",
      });
    });
  });

  describe("addEvaluator", () => {
    it("auto-maps across datasets and targets", () => {
      const { state, result } = addEvaluator({
        state: baseState(),
        payload: {
          evaluatorType: "langevals/exact_match",
          dbEvaluatorId: "db-evaluator-3",
          inputs: [
            { identifier: "output", type: "str" },
            { identifier: "expected_output", type: "str" },
          ],
        },
      });

      const added = state.evaluators[1]!;
      expect(added.id).toBe(result?.evaluatorId);
      expect(added.mappings["ds-1"]!["target-a"]).toEqual({
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
      });
    });

    it("keeps mappings given on the payload", () => {
      const { state } = addEvaluator({
        state: baseState(),
        payload: {
          id: "evaluator_fixed",
          evaluatorType: "langevals/exact_match",
          inputs: [{ identifier: "output", type: "str" }],
          mappings: {
            "ds-1": {
              "target-a": { output: { type: "value", value: "fixed" } },
            },
          },
        },
      });

      expect(
        state.evaluators[1]!.mappings["ds-1"]!["target-a"]!.output,
      ).toEqual({ type: "value", value: "fixed" });
    });
  });

  describe("setTargetPrompt", () => {
    const localPromptConfig = {
      llm: { model: "openai/gpt-5-mini" },
      messages: [{ role: "user" as const, content: "Answer {{input}}" }],
      inputs: [{ identifier: "input", type: "str" as const }],
      outputs: [{ identifier: "output", type: "str" as const }],
    };

    it("writes the draft config and the variables that came with it", () => {
      const { state, result } = setTargetPrompt({
        state: baseState(),
        payload: {
          targetId: "target-a",
          localPromptConfig,
          inputs: [{ identifier: "input", type: "str" }],
        },
      });

      expect(result?.targetId).toBe("target-a");
      expect(state.targets[0]!.localPromptConfig).toEqual(localPromptConfig);
      expect(state.targets[0]!.inputs).toEqual([
        { identifier: "input", type: "str" },
      ]);
    });

    it("rejects a config the prompt schema does not accept", () => {
      expect(() =>
        setTargetPrompt({
          state: baseState(),
          payload: {
            targetId: "target-a",
            localPromptConfig: { llm: {} } as never,
          },
        }),
      ).toThrow();
    });

    it("refuses an unknown target", () => {
      expect(
        refusalCode(() =>
          setTargetPrompt({
            state: baseState(),
            payload: { targetId: "nope", localPromptConfig },
          }),
        ),
      ).toBe("target_not_found");
    });
  });

  describe("updateTargetModel", () => {
    it("switches the draft's model", () => {
      const state = baseState();
      state.targets[0]!.localPromptConfig = {
        llm: { model: "openai/gpt-5-mini", temperature: 0.2 },
        messages: [],
        inputs: [],
        outputs: [],
      };

      const { state: next, result } = updateTargetModel({
        state,
        payload: { targetId: "target-a", model: "anthropic/claude-opus-4" },
      });

      expect(next.targets[0]!.localPromptConfig?.llm).toEqual({
        model: "anthropic/claude-opus-4",
        temperature: 0.2,
      });
      expect(result?.model).toBe("anthropic/claude-opus-4");
    });

    describe("when the target has no draft config", () => {
      /** @scenario "Changing the model needs a prompt draft to change" */
      it("refuses with target_prompt_config_missing", () => {
        expect(
          refusalCode(() =>
            updateTargetModel({
              state: baseState(),
              payload: { targetId: "target-a", model: "openai/gpt-5-mini" },
            }),
          ),
        ).toBe("target_prompt_config_missing");
      });
    });
  });

  describe("setTargetMapping", () => {
    it("writes the mapping for that dataset only", () => {
      const { state } = setTargetMapping({
        state: baseState(),
        payload: {
          targetId: "target-a",
          datasetId: "ds-2",
          inputField: "input",
          mapping: { type: "value", value: "constant" },
        },
      });

      expect(state.targets[0]!.mappings["ds-2"]!.input).toEqual({
        type: "value",
        value: "constant",
      });
      expect(state.targets[0]!.mappings["ds-1"]!.input).toBeDefined();
    });

    it("refuses an unknown target", () => {
      expect(
        refusalCode(() =>
          setTargetMapping({
            state: baseState(),
            payload: {
              targetId: "nope",
              datasetId: "ds-1",
              inputField: "input",
              mapping: { type: "value", value: "x" },
            },
          }),
        ),
      ).toBe("target_not_found");
    });
  });

  describe("setEvaluatorMapping", () => {
    it("writes into the dataset and target bucket", () => {
      const { state } = setEvaluatorMapping({
        state: baseState(),
        payload: {
          evaluatorId: "evaluator_1",
          datasetId: "ds-1",
          targetId: "target-a",
          inputField: "rubric",
          mapping: { type: "value", value: "be exact" },
        },
      });

      expect(
        state.evaluators[0]!.mappings["ds-1"]!["target-a"]!.rubric,
      ).toEqual({ type: "value", value: "be exact" });
    });

    it("refuses an unknown evaluator", () => {
      expect(
        refusalCode(() =>
          setEvaluatorMapping({
            state: baseState(),
            payload: {
              evaluatorId: "nope",
              datasetId: "ds-1",
              targetId: "target-a",
              inputField: "rubric",
              mapping: { type: "value", value: "x" },
            },
          }),
        ),
      ).toBe("evaluator_not_found");
    });
  });

  describe("removeTarget", () => {
    it("drops the column, its evaluator bucket and every reference to it", () => {
      const state = baseState();
      state.targets.push({
        id: "target-b",
        type: "prompt",
        inputs: [{ identifier: "context", type: "str" }],
        outputs: [],
        mappings: {
          "ds-1": {
            context: {
              type: "source",
              source: "target",
              sourceId: "target-a",
              sourceField: "output",
            },
          },
        },
      });
      state.evaluators.push({
        id: "evaluator_comparison",
        evaluatorType: "langevals/select_best_compare",
        inputs: [],
        mappings: {},
        comparison: {
          variants: ["target-a", "target-b"],
          hasGoldenAnswer: false,
          includeMetrics: [],
          randomizeOrder: true,
        },
      });

      const { state: next } = removeTarget({
        state,
        payload: { targetId: "target-a" },
      });

      expect(next.targets.map((t) => t.id)).toEqual(["target-b"]);
      expect(next.evaluators[0]!.mappings["ds-1"]!["target-a"]).toBeUndefined();
      expect(next.targets[0]!.mappings["ds-1"]!.context).toBeUndefined();
      expect(next.evaluators[1]!.comparison?.variants).toEqual(["target-b"]);
    });
  });

  describe("setCellValue", () => {
    it("writes the cell", () => {
      const { state } = setCellValue({
        state: baseState(),
        payload: {
          datasetId: "ds-1",
          rowIndex: 1,
          columnId: "input",
          value: "edited",
        },
      });

      expect(state.datasets[0]!.inline!.records.input).toEqual([
        "first question",
        "edited",
      ]);
    });

    it("pads a short column up to the row being written", () => {
      const { state } = setCellValue({
        state: baseState(),
        payload: {
          datasetId: "ds-1",
          rowIndex: 3,
          columnId: "input",
          value: "fourth",
        },
      });

      expect(state.datasets[0]!.inline!.records.input).toEqual([
        "first question",
        "second question",
        "",
        "fourth",
      ]);
    });

    describe("when the dataset is saved", () => {
      /** @scenario "Rows and columns of a saved dataset are not edited through the workbench" */
      it("refuses with dataset_not_editable", () => {
        const state = baseState();
        state.datasets.push(savedDataset());

        expect(
          refusalCode(() =>
            setCellValue({
              state,
              payload: {
                datasetId: "ds-saved",
                rowIndex: 0,
                columnId: "input",
                value: "edited",
              },
            }),
          ),
        ).toBe("dataset_not_editable");
      });
    });

    describe("when the dataset does not exist", () => {
      it("refuses with dataset_not_found", () => {
        expect(
          refusalCode(() =>
            setCellValue({
              state: baseState(),
              payload: {
                datasetId: "nope",
                rowIndex: 0,
                columnId: "input",
                value: "edited",
              },
            }),
          ),
        ).toBe("dataset_not_found");
      });
    });
  });

  describe("addColumn", () => {
    it("adds the column to the reference and the inline block, filled with empty cells", () => {
      const { state, result } = addColumn({
        state: baseState(),
        payload: { datasetId: "ds-1", column: { name: "context" } },
      });

      expect(result?.columnId).toBe("context");
      expect(state.datasets[0]!.columns.map((c) => c.id)).toContain("context");
      expect(state.datasets[0]!.inline!.columns.map((c) => c.id)).toContain(
        "context",
      );
      expect(state.datasets[0]!.inline!.records.context).toEqual(["", ""]);
    });

    it("refuses a column that already exists", () => {
      expect(
        refusalCode(() =>
          addColumn({
            state: baseState(),
            payload: { datasetId: "ds-1", column: { name: "input" } },
          }),
        ),
      ).toBe("column_already_exists");
    });

    it("refuses a saved dataset", () => {
      const state = baseState();
      state.datasets.push(savedDataset());

      expect(
        refusalCode(() =>
          addColumn({
            state,
            payload: { datasetId: "ds-saved", column: { name: "context" } },
          }),
        ),
      ).toBe("dataset_not_editable");
    });
  });

  describe("addRows", () => {
    /** @scenario "New rows land in every column" */
    it("appends rows column-first, by column id or column name", () => {
      const { state, result } = addRows({
        state: baseState(),
        payload: {
          datasetId: "ds-1",
          rows: [
            { input: "third question", expected_output: "third answer" },
            { input: "fourth question" },
          ],
        },
      });

      expect(state.datasets[0]!.inline!.records).toEqual({
        input: [
          "first question",
          "second question",
          "third question",
          "fourth question",
        ],
        expected_output: ["first answer", "second answer", "third answer", ""],
      });
      expect(result).toEqual({ datasetId: "ds-1", addedRows: 2, rowCount: 4 });
    });

    it("aligns a ragged column before appending", () => {
      const state = baseState();
      state.datasets[0]!.inline!.records.expected_output = ["first answer"];

      const { state: next } = addRows({
        state,
        payload: { datasetId: "ds-1", rows: [{ input: "third question" }] },
      });

      expect(next.datasets[0]!.inline!.records.expected_output).toEqual([
        "first answer",
        "",
        "",
      ]);
    });

    it("refuses a saved dataset", () => {
      const state = baseState();
      state.datasets.push(savedDataset());

      expect(
        refusalCode(() =>
          addRows({
            state,
            payload: { datasetId: "ds-saved", rows: [{ input: "x" }] },
          }),
        ),
      ).toBe("dataset_not_editable");
    });
  });

  describe("refusals", () => {
    it("throws TransformError, carrying the ids the caller named", () => {
      try {
        setCellValue({
          state: baseState(),
          payload: {
            datasetId: "nope",
            rowIndex: 0,
            columnId: "input",
            value: "",
          },
        });
        expect.unreachable("the unknown dataset must refuse");
      } catch (error) {
        expect(error).toBeInstanceOf(TransformError);
        expect((error as TransformError).code).toBe("dataset_not_found");
        expect((error as TransformError).meta).toEqual({ datasetId: "nope" });
      }
    });
  });

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

    it.each(fixtures)("parses the $kind fixture", ({ schema, payload }) => {
      expect(schema.safeParse(payload).success).toBe(true);
    });
  });
});
