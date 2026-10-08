/**
 * Instant Evals answers LLM judges only, so an evaluator of any other type naming it as its
 * model is refused, naming the evaluator.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  InstantEvalJudgeOnlyModelError,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import {
  assertInstantEvalOnlyOnJudgeEvaluator,
  isInstantEvalOutsideJudge,
} from "../instant-eval-outside-judge.ts";

const IE = INSTANT_EVAL_JUDGE_MODEL_ID;

describe("isInstantEvalOutsideJudge()", () => {
  /** @scenario "An evaluator that is not an LLM judge is refused Instant Evals by name" */
  it.each([
    { evaluatorType: "ragas/faithfulness", model: IE, outside: true },
    { evaluatorType: "langevals/off_topic", model: IE, outside: true },
    { evaluatorType: "langevals/llm_boolean", model: IE, outside: false },
    { evaluatorType: "langevals/llm_score", model: IE, outside: false },
    { evaluatorType: "langevals/llm_category", model: IE, outside: false },
    { evaluatorType: "ragas/faithfulness", model: "openai/gpt-5-mini", outside: false },
    { evaluatorType: "ragas/faithfulness", model: undefined, outside: false },
    { evaluatorType: undefined, model: IE, outside: false },
  ])("is $outside for $evaluatorType on $model", ({ evaluatorType, model, outside }) => {
    expect(isInstantEvalOutsideJudge({ evaluatorType, model })).toBe(outside);
  });
});

describe("assertInstantEvalOnlyOnJudgeEvaluator()", () => {
  const ragasOnIE = { evaluatorType: "ragas/faithfulness", settings: { model: IE } };

  /** @scenario "An evaluator that is not an LLM judge is refused Instant Evals by name" */
  it("refuses as a client error that names the evaluator", () => {
    const refuse = () =>
      assertInstantEvalOnlyOnJudgeEvaluator({ name: "Grounded", config: ragasOnIE });

    expect(refuse).toThrow(InstantEvalJudgeOnlyModelError);
    expect(refuse).toThrow(
      expect.objectContaining({
        httpStatus: 422,
        meta: expect.objectContaining({ places: ['evaluator "Grounded"'] }),
      }),
    );
  });

  it("reads the type from the stored config when the new one names none", () => {
    const refuse = () =>
      assertInstantEvalOnlyOnJudgeEvaluator({
        name: "Grounded",
        config: { settings: { model: IE } },
        storedConfig: { evaluatorType: "ragas/faithfulness" },
      });

    expect(refuse).toThrow(InstantEvalJudgeOnlyModelError);
  });

  it("shortens a long evaluator name so the message stays readable", () => {
    const refuse = () =>
      assertInstantEvalOnlyOnJudgeEvaluator({ name: "A".repeat(80), config: ragasOnIE });

    expect(refuse).toThrow(
      expect.objectContaining({
        meta: expect.objectContaining({ places: [expect.stringMatching(/^evaluator "A+…"$/)] }),
      }),
    );
  });

  /** @scenario "An LLM judge evaluator on Instant Evals still saves, copies, pushes and syncs" */
  it.each([
    { evaluatorType: "langevals/llm_boolean", settings: { model: IE } },
    { evaluatorType: "ragas/faithfulness", settings: { model: "openai/gpt-5-mini" } },
    { code: "class Code: ..." },
    null,
    "not a config",
  ])("lets %j through", (config) => {
    expect(() => assertInstantEvalOnlyOnJudgeEvaluator({ name: "Fine", config })).not.toThrow();
  });
});
