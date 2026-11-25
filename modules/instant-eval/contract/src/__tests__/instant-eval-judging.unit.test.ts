/**
 * What a judged conversation may hold under the judge's own limits, which a caller trims a
 * synchronous query to before `judgeQuery` (Alex, 2026-10-08, round 26 CD-4).
 * @see specs/lwql/eval-functions.feature
 */
import type { LangWatchQLJudgementCall } from "@langwatch/analytics-contract";
import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  instantEvalTextBudget,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import { computeInstantEvalTranscriptFit, toInstantEvalQuestion } from "../instant-eval-judging.ts";

const annoyed: LangWatchQLJudgementCall = {
  column: "annoyed",
  function: "eval",
  reads: "probability",
  kind: "boolean",
  instructions: "The customer sounds annoyed",
};

describe("computeInstantEvalTranscriptFit", () => {
  describe("when the questions leave the judge room for text", () => {
    it("measures the text at the judge's transcript ratio and renders it in the four-bytes ruler", () => {
      const limits = INSTANT_EVAL_CLASSIFIER_LIMITS;
      const budget = instantEvalTextBudget({
        questions: [toInstantEvalQuestion(annoyed)],
        limits,
      });

      const fit = computeInstantEvalTranscriptFit({ judgements: [annoyed], limits });

      expect(fit).toEqual({
        maxBytes: Math.floor(budget * limits.transcriptFitBytesPerInputToken),
        renderTokens: Math.floor((budget * limits.transcriptFitBytesPerInputToken) / 4),
      });
    });
  });

  describe("when the questions alone fill the judge's state", () => {
    it("gives no fit, leaving the refusal to judgeQuery", () => {
      const limits = { ...INSTANT_EVAL_CLASSIFIER_LIMITS, stateTokens: 10 };

      expect(computeInstantEvalTranscriptFit({ judgements: [annoyed], limits })).toBeUndefined();
    });
  });
});
