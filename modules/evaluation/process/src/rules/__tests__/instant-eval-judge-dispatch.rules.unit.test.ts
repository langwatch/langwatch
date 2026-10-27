import { AVAILABLE_EVALUATORS } from "@langwatch/evaluator-contract";
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import {
  instantEvalJudgeInputsOf,
  instantEvalJudgeOf,
} from "../instant-eval-judge-dispatch.rules.ts";

const OWN_DECISION_MODEL = "openai/decisions:gpt-6-luna";

describe("instantEvalJudgeOf", () => {
  describe("given a boolean judge whose model is Instant Evals", () => {
    it("answers the judge with its prompt", () => {
      expect(
        instantEvalJudgeOf({
          evaluatorType: "langevals/llm_boolean",
          settings: { model: INSTANT_EVAL_JUDGE_MODEL_ID, prompt: "is it polite?" },
        }),
      ).toEqual({
        kind: "instant_eval",
        judge: { evaluatorType: "langevals/llm_boolean", settings: { prompt: "is it polite?" } },
      });
    });

    it("carries no decision model, so the project's column still decides", () => {
      expect(
        instantEvalJudgeOf({
          evaluatorType: "langevals/llm_boolean",
          settings: { model: INSTANT_EVAL_JUDGE_MODEL_ID, prompt: "is it polite?" },
        }),
      ).not.toHaveProperty("decisionModel");
    });
  });

  describe("given a score judge with a range", () => {
    it("keeps the range", () => {
      expect(
        instantEvalJudgeOf({
          evaluatorType: "langevals/llm_score",
          settings: { model: INSTANT_EVAL_JUDGE_MODEL_ID, prompt: "rate it", min: 1, max: 5 },
        }),
      ).toEqual({
        kind: "instant_eval",
        judge: {
          evaluatorType: "langevals/llm_score",
          settings: { prompt: "rate it", min: 1, max: 5 },
        },
      });
    });
  });

  describe("given a category judge with no saved categories or prompt", () => {
    it("reads the evaluator's own defaults", () => {
      const defaults = AVAILABLE_EVALUATORS["langevals/llm_category"]?.settings as Record<
        string,
        { default: unknown }
      >;

      expect(
        instantEvalJudgeOf({
          evaluatorType: "langevals/llm_category",
          settings: { model: INSTANT_EVAL_JUDGE_MODEL_ID },
        }),
      ).toEqual({
        kind: "instant_eval",
        judge: {
          evaluatorType: "langevals/llm_category",
          settings: { prompt: defaults.prompt?.default, categories: defaults.categories?.default },
        },
      });
    });
  });

  describe("given a judge on a provider model", () => {
    it("answers nothing, so the judge runs as today", () => {
      expect(
        instantEvalJudgeOf({
          evaluatorType: "langevals/llm_boolean",
          settings: { model: "openai/gpt-5-mini", prompt: "is it polite?" },
        }),
      ).toEqual({ kind: "runs_as_today" });
    });
  });

  describe("given an evaluator that is not an LLM judge", () => {
    it("answers nothing, even when its settings name Instant Evals", () => {
      expect(
        instantEvalJudgeOf({
          evaluatorType: "openai/moderation",
          settings: { model: INSTANT_EVAL_JUDGE_MODEL_ID },
        }),
      ).toEqual({ kind: "runs_as_today" });
    });
  });

  describe("given no settings", () => {
    it("answers nothing", () => {
      expect(
        instantEvalJudgeOf({ evaluatorType: "langevals/llm_boolean", settings: undefined }),
      ).toEqual({ kind: "runs_as_today" });
    });
  });

  describe("given a judge whose model is an own decision model", () => {
    /** @scenario "A judge on an own decision model is answered by Instant Evals" */
    it("answers the judge and carries the picked model", () => {
      expect(
        instantEvalJudgeOf({
          evaluatorType: "langevals/llm_boolean",
          settings: { model: OWN_DECISION_MODEL, prompt: "is it polite?" },
        }),
      ).toEqual({
        kind: "instant_eval",
        decisionModel: OWN_DECISION_MODEL,
        judge: { evaluatorType: "langevals/llm_boolean", settings: { prompt: "is it polite?" } },
      });
    });

    it("keeps a score judge's range, as for Instant Evals", () => {
      expect(
        instantEvalJudgeOf({
          evaluatorType: "langevals/llm_score",
          settings: { model: OWN_DECISION_MODEL, prompt: "rate it", min: 0, max: 10 },
        }),
      ).toEqual({
        kind: "instant_eval",
        decisionModel: OWN_DECISION_MODEL,
        judge: {
          evaluatorType: "langevals/llm_score",
          settings: { prompt: "rate it", min: 0, max: 10 },
        },
      });
    });
  });

  describe("given a judge whose model only looks like a decision model", () => {
    /** @scenario "A judge on a chat model still runs as it does today" */
    it("answers nothing for an id the catalogue does not hold", () => {
      expect(
        instantEvalJudgeOf({
          evaluatorType: "langevals/llm_boolean",
          settings: { model: "openai/decisions:made-up", prompt: "is it polite?" },
        }),
      ).toEqual({ kind: "runs_as_today" });
    });

    it("answers nothing for a model that is not text", () => {
      expect(
        instantEvalJudgeOf({ evaluatorType: "langevals/llm_boolean", settings: { model: 7 } }),
      ).toEqual({ kind: "runs_as_today" });
    });
  });
});

describe("instantEvalJudgeInputsOf", () => {
  describe("given mapped input, output and contexts", () => {
    it("reads text as is and each context as its text", () => {
      expect(
        instantEvalJudgeInputsOf({
          input: "question",
          output: "answer",
          contexts: ["first", { content: "second" }, { id: 3 }],
        }),
      ).toEqual({
        input: "question",
        output: "answer",
        contexts: ["first", "second", JSON.stringify({ id: 3 })],
      });
    });
  });

  describe("given structured input and output", () => {
    it("reads them as JSON", () => {
      expect(
        instantEvalJudgeInputsOf({ input: { a: 1 }, output: [1, 2], contexts: "one context" }),
      ).toEqual({ input: '{"a":1}', output: "[1,2]", contexts: ["one context"] });
    });
  });

  describe("given nothing mapped", () => {
    it("reads empty", () => {
      expect(instantEvalJudgeInputsOf({ input: null })).toEqual({});
    });
  });
});
