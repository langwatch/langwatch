/**
 * Reading an LLM leg's answer: an OpenAI answer the provider stopped before the evaluation call
 * names why, so a reasoning model running out of room is told apart from an unreadable call.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type { InstantEvalBooleanQuestion } from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import { readInstantEvalLlmJudgeAnswer } from "../instant-eval-llm-judge-wire.rules.ts";

const QUESTION: InstantEvalBooleanQuestion = {
  id: "upset",
  kind: "boolean",
  instructions: "Is the user upset?",
};

const read = (body: unknown) =>
  readInstantEvalLlmJudgeAnswer({ wire: "openai_responses", body, question: QUESTION });

describe("readInstantEvalLlmJudgeAnswer, given an OpenAI Responses answer", () => {
  describe("when the provider stopped it at the output cap before the evaluation call", () => {
    /** @scenario "A reasoning effort is sent only when the backend sets one" */
    it("is no answer that names the stop reason and keeps the billed tokens", () => {
      expect(
        read({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [{ type: "reasoning" }],
          usage: { input_tokens: 500, output_tokens: 32_000 },
        }),
      ).toEqual({
        outcome: "none",
        stoppedBy: "max_output_tokens",
        inputTokens: 500,
        outputTokens: 32_000,
      });
    });
  });

  describe("when the answer is complete but holds no evaluation call", () => {
    /** @scenario "A reasoning effort is sent only when the backend sets one" */
    it("is no answer with no stop reason", () => {
      expect(
        read({ status: "completed", output: [], usage: { input_tokens: 5, output_tokens: 1 } }),
      ).toEqual({ outcome: "none", inputTokens: 5, outputTokens: 1 });
    });
  });

  describe("when an incomplete answer still made its evaluation call", () => {
    /** @scenario "A reasoning effort is sent only when the backend sets one" */
    it("reads the call", () => {
      expect(
        read({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [
            {
              type: "function_call",
              name: "evaluation",
              arguments: '{"reasoning":"r","result":true}',
            },
          ],
        }),
      ).toEqual({ outcome: "value", value: { verdict: true }, inputTokens: 0, outputTokens: 0 });
    });
  });
});
