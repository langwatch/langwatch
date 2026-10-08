/**
 * Instant Evals answers LLM judges only, so a workbench naming it on a target that calls a model,
 * or on an evaluator column that is not a judge, is refused, naming it. Judge columns keep it.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  InstantEvalJudgeOnlyModelError,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import {
  assertNoInstantEvalJudgeModelTargets,
  instantEvalJudgeModelTargetsOf,
} from "../instant-eval-judge-model-targets.ts";

const promptTarget = ({ id, model }: { id: string; model: string }) => ({
  id,
  type: "prompt",
  localPromptConfig: { llm: { model }, messages: [], inputs: [], outputs: [] },
  mappings: {},
});

const evaluatorTarget = {
  id: "judge_target",
  type: "evaluator",
  targetEvaluatorId: "evaluator_1",
  localEvaluatorConfig: { settings: { model: INSTANT_EVAL_JUDGE_MODEL_ID } },
  mappings: {},
};

const judgeColumn = {
  id: "judge_column",
  evaluatorType: "langevals/llm_boolean",
  dbEvaluatorId: "evaluator_2",
  localEvaluatorConfig: { settings: { model: INSTANT_EVAL_JUDGE_MODEL_ID } },
  settings: { model: INSTANT_EVAL_JUDGE_MODEL_ID },
  mappings: {},
};

const state = (targets: unknown[]) => ({
  name: "My evaluation",
  datasets: [],
  activeDatasetId: "dataset_1",
  evaluators: [judgeColumn],
  targets,
});

const ragasColumn = ({
  id,
  localEvaluatorConfig,
  settings,
}: {
  id: string;
  localEvaluatorConfig?: { name: string; settings?: Record<string, unknown> };
  settings?: Record<string, unknown>;
}) => ({
  id,
  evaluatorType: "ragas/faithfulness",
  dbEvaluatorId: "evaluator_3",
  ...(localEvaluatorConfig ? { localEvaluatorConfig } : {}),
  ...(settings ? { settings } : {}),
  mappings: {},
});

describe("instantEvalJudgeModelTargetsOf()", () => {
  describe("when a prompt target's unsaved prompt draft names Instant Evals", () => {
    /** @scenario "A workflow or a workbench naming Instant Evals outside a judge is refused where it sits" */
    it("names the target by its column position", () => {
      const named = instantEvalJudgeModelTargetsOf({
        state: state([
          promptTarget({ id: "fine", model: "openai/gpt-5-mini" }),
          promptTarget({ id: "broken", model: INSTANT_EVAL_JUDGE_MODEL_ID }),
        ]),
      });

      expect(named).toEqual(["target 2"]);
    });
  });

  describe("when an evaluator column that is not an LLM judge names Instant Evals", () => {
    /** @scenario "A workflow or a workbench naming Instant Evals on an evaluator that is not a judge is refused where it sits" */
    it("names the column by its unsaved name, or else its position, before any target", () => {
      const named = instantEvalJudgeModelTargetsOf({
        state: {
          ...state([promptTarget({ id: "broken", model: INSTANT_EVAL_JUDGE_MODEL_ID })]),
          evaluators: [
            judgeColumn,
            ragasColumn({
              id: "unsaved",
              localEvaluatorConfig: {
                name: "Grounded",
                settings: { model: INSTANT_EVAL_JUDGE_MODEL_ID },
              },
            }),
            ragasColumn({ id: "legacy", settings: { model: INSTANT_EVAL_JUDGE_MODEL_ID } }),
            ragasColumn({ id: "fine", settings: { model: "openai/gpt-5-mini" } }),
          ],
        },
      });

      expect(named).toEqual(['evaluator "Grounded"', "evaluator 3", "target 1"]);
    });
  });

  describe("when Instant Evals sits only on evaluators", () => {
    /** @scenario "A workbench whose evaluators judge on Instant Evals still saves" */
    it("names nothing", () => {
      const named = instantEvalJudgeModelTargetsOf({
        state: state([evaluatorTarget, promptTarget({ id: "fine", model: "openai/gpt-5-mini" })]),
      });

      expect(named).toEqual([]);
    });
  });

  describe("when the state is not shaped as one", () => {
    it.each([undefined, null, "state", { targets: "none" }, { targets: [null, 3, { type: 1 }] }])(
      "names nothing for %s",
      (value) => {
        expect(instantEvalJudgeModelTargetsOf({ state: value })).toEqual([]);
      },
    );
  });
});

describe("assertNoInstantEvalJudgeModelTargets()", () => {
  /** @scenario "A workflow or a workbench naming Instant Evals outside a judge is refused where it sits" */
  it("refuses as a client error that names the target", () => {
    const refuse = () =>
      assertNoInstantEvalJudgeModelTargets({
        state: state([promptTarget({ id: "broken", model: INSTANT_EVAL_JUDGE_MODEL_ID })]),
      });

    expect(refuse).toThrow(InstantEvalJudgeOnlyModelError);
    expect(refuse).toThrow(
      expect.objectContaining({
        httpStatus: 422,
        meta: expect.objectContaining({ places: ["target 1"] }),
      }),
    );
  });
});
