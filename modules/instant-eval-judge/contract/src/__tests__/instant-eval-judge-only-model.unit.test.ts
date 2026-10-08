/**
 * Instant Evals answers evaluator judges only, so a save naming it anywhere else is refused.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  assertNotInstantEvalJudgeModel,
  isInstantEvalJudgeOnlyRefusal,
  refuseInstantEvalJudgeModel,
} from "../instant-eval-judge-only-model.ts";
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "../instant-eval-judge.api.ts";
import {
  INSTANT_EVAL_JUDGE_ONLY_MESSAGE,
  InstantEvalJudgeOnlyModelError,
} from "../instant-eval-judge.errors.ts";

describe("assertNotInstantEvalJudgeModel()", () => {
  describe("when the model is Instant Evals", () => {
    /** @scenario "Saving Instant Evals as the model of anything but a judge is refused" */
    it("refuses as a client error in plain words", () => {
      const refuse = () => assertNotInstantEvalJudgeModel({ model: INSTANT_EVAL_JUDGE_MODEL_ID });

      expect(refuse).toThrow(InstantEvalJudgeOnlyModelError);
      expect(refuse).toThrow(
        expect.objectContaining({ httpStatus: 422, message: INSTANT_EVAL_JUDGE_ONLY_MESSAGE }),
      );
    });
  });

  describe("when the model is any other or absent", () => {
    /** @scenario "A prompt or an agent with any other model still saves" */
    it.each(["openai/gpt-5-mini", undefined, null, ""])("lets %s through", (model) => {
      expect(() => assertNotInstantEvalJudgeModel({ model })).not.toThrow();
    });
  });
});

describe("refuseInstantEvalJudgeModel", () => {
  const schema = z.string().refine(...refuseInstantEvalJudgeModel);

  it("fails a schema on Instant Evals with the plain message", () => {
    const result = schema.safeParse(INSTANT_EVAL_JUDGE_MODEL_ID);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(INSTANT_EVAL_JUDGE_ONLY_MESSAGE);
  });

  it("passes any other model", () => {
    expect(schema.validate("openai/gpt-5-mini")).toBe(true);
  });
});

describe("InstantEvalJudgeOnlyModelError", () => {
  describe("when the save names where Instant Evals sits", () => {
    /** @scenario "A workflow or a workbench naming Instant Evals outside a judge is refused where it sits" */
    it("names each place in its message and its meta", () => {
      const error = new InstantEvalJudgeOnlyModelError({
        places: ['node "Answer"', "target 2"],
      });

      expect(error.message).toBe(
        'Instant Evals runs only LLM judge evaluators. Pick another model for node "Answer", target 2.',
      );
      expect(error.meta).toEqual({ places: ['node "Answer"', "target 2"] });
    });
  });

  describe("when it names no place", () => {
    it("keeps the plain message", () => {
      expect(new InstantEvalJudgeOnlyModelError().message).toBe(
        "Instant Evals runs only LLM judge evaluators.",
      );
    });
  });
});

describe("isInstantEvalJudgeOnlyRefusal()", () => {
  /** @scenario "An autosave refused for Instant Evals outside a judge names where it sits" */
  it("answers true for the refusal, thrown or as the tRPC envelope carries it", () => {
    const envelope = {
      data: { error: { code: "instant_eval_judge_only_model", httpStatus: 422, message: "" } },
    };

    expect(isInstantEvalJudgeOnlyRefusal(new InstantEvalJudgeOnlyModelError())).toBe(true);
    expect(isInstantEvalJudgeOnlyRefusal(envelope)).toBe(true);
  });

  /** @scenario "Any other autosave failure keeps its generic message" */
  it("answers false for any other failure", () => {
    expect(isInstantEvalJudgeOnlyRefusal(new Error("Network error"))).toBe(false);
    expect(isInstantEvalJudgeOnlyRefusal(undefined)).toBe(false);
  });
});
