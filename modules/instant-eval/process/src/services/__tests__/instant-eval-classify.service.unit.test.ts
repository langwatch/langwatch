/**
 * A classification asked for outside any run, which is how a peer routes a
 * sentence: the judge answers, or skips and the peer falls back.
 * @see specs/instant-evals/classifier.feature
 */

import type { InstantEvalJudgement, InstantEvalQuestion } from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import type { InstantEvalClassifyRequest } from "../../channels/instant-eval-judge.channel.ts";
import { MemoryInstantEvalJudgeChannel } from "../../channels/memory/memory.instant-eval-judge.channel.ts";
import { INSTANT_EVAL_PRICING } from "../../rules/instant-eval-pricing.rules.ts";
import { InstantEvalClassifyService } from "../instant-eval-classify.service.ts";

const question: InstantEvalQuestion = {
  id: "route",
  kind: "category",
  instructions: "Which route does this sentence want",
  options: [
    { name: "filter", description: "a filter" },
    { name: "instant_eval", description: "a judgement" },
  ],
};

/** A judge that records what it was asked and answers the route. */
class RecordingJudge {
  readonly requests: InstantEvalClassifyRequest[] = [];
  readonly limits = MemoryInstantEvalJudgeChannel.create().limits;
  readonly pricing = INSTANT_EVAL_PRICING;

  async classify(request: InstantEvalClassifyRequest): Promise<InstantEvalJudgement> {
    this.requests.push(request);

    return {
      verdicts: [{ questionId: "route", label: "instant_eval" }],
      inputTokens: 120,
      isTextTruncated: false,
    };
  }
}

describe("given a peer with text of its own to classify", () => {
  describe("when the deployment has a judge", () => {
    it("asks it for the project the text belongs to and answers its verdicts", async () => {
      const judge = new RecordingJudge();
      const classifications = InstantEvalClassifyService.create({ judge });

      const judgement = await classifications.classify({
        projectId: "project-1",
        text: "annoyed users",
        questions: [question],
      });

      expect(judge.requests).toEqual([
        { projectId: "project-1", text: "annoyed users", questions: [question] },
      ]);
      expect(judgement.verdicts).toEqual([{ questionId: "route", label: "instant_eval" }]);
    });
  });

  describe("when the deployment has none", () => {
    it("skips by name instead of refusing, so the caller can fall back", async () => {
      const classifications = InstantEvalClassifyService.create({
        judge: MemoryInstantEvalJudgeChannel.create(),
      });

      const judgement = await classifications.classify({
        projectId: "project-1",
        text: "annoyed users",
        questions: [question],
      });

      expect(judgement.skippedReason).toBe("classifier_not_configured");
      expect(judgement.verdicts).toEqual([]);
    });
  });
});
