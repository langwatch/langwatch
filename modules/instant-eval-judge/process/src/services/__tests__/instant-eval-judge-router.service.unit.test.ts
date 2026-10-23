/**
 * The router over scripted channels: escalation on unsure, the confident pair, fallbacks, the
 * kept primary when the LLM leg fails, and the skip when nothing answers. No network.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  InstantEvalClassifierUnavailableError,
  instantEvalSkipped,
  type InstantEvalJudgement,
  type InstantEvalJudgeRoute,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import { MemoryInstantEvalClassifierChannel } from "../../__tests__/support/instant-eval-classifier.test-fakes.ts";
import {
  syntheticRouteTable,
  yesNo,
} from "../../__tests__/support/instant-eval-judge-route.test-fakes.ts";
import {
  ScriptedInstantEvalHostedDecisionsChannel,
  ScriptedInstantEvalLlmJudgeChannel,
} from "../../__tests__/support/instant-eval-judge-router.test-fakes.ts";
import { MemoryInstantEvalRateLimiter } from "../../__tests__/support/instant-eval-rate-limiter.test-fakes.ts";
import type { InstantEvalLlmJudgeAnswer } from "../../channels/instant-eval-llm-judge.channel.ts";
import { InstantEvalJudgeRouterService } from "../instant-eval-judge-router.service.ts";

const Q = yesNo("q", "is the user upset");

const PRICING: InstantEvalJudgeRoutePricing = {
  version: "test",
  markup: 1.3,
  backends: {
    "decision-a": { usdPerMillionInputTokens: 0.1, usdPerMillionOutputTokens: 0 },
    "decision-b": { usdPerMillionInputTokens: 0.05, usdPerMillionOutputTokens: 0 },
    "llm-a": { usdPerMillionInputTokens: 2, usdPerMillionOutputTokens: 8 },
    "llm-b": { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 5 },
  },
};

function judged(probability: number, inputTokens = 1000): InstantEvalJudgement {
  return { verdicts: [{ questionId: Q.id, probability }], inputTokens, isTextTruncated: false };
}

const llmSays = (verdict: boolean): InstantEvalLlmJudgeAnswer => ({
  outcome: "answered",
  verdict,
  inputTokens: 2000,
  outputTokens: 100,
});

type Script = () => InstantEvalJudgement;

function harness({
  decisions = () => judged(0.05),
  jev = () => judged(0.5),
  llm = () => llmSays(true),
  hasDecisions = true,
}: {
  decisions?: Script;
  jev?: Script;
  llm?: () => InstantEvalLlmJudgeAnswer;
  hasDecisions?: boolean;
} = {}) {
  const hostedDecisions = ScriptedInstantEvalHostedDecisionsChannel.create({ answer: decisions });
  const llmJudge = ScriptedInstantEvalLlmJudgeChannel.create({ answer: llm });
  let jevCalls = 0;
  const classifier = MemoryInstantEvalClassifierChannel.create({
    answer: async () => {
      jevCalls += 1;
      return jev();
    },
  });
  const router = InstantEvalJudgeRouterService.create({
    table: syntheticRouteTable(),
    pricing: PRICING,
    classifier,
    hostedDecisions: hasDecisions ? hostedDecisions : undefined,
    llmJudge,
    limiter: MemoryInstantEvalRateLimiter.create(),
  });
  const classify = (route: InstantEvalJudgeRoute, questions: InstantEvalQuestion[] = [Q]) =>
    router.classify({ projectId: "project-1", text: "user: late again", questions, route });
  return { classify, hostedDecisions, llmJudge, jevCalls: () => jevCalls };
}

const SHORT: InstantEvalJudgeRoute = { job: "search", tokens: 500 };
const PAIRED: InstantEvalJudgeRoute = { job: "search", tokens: 5000 };

describe("InstantEvalJudgeRouterService", () => {
  describe("given a plan that escalates unsure answers", () => {
    /** @scenario "A sure decision-model answer stays" */
    it("keeps a sure answer and never calls the LLM", async () => {
      const { classify, llmJudge } = harness({ decisions: () => judged(0.05) });
      const judgement = await classify(SHORT);
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.05 }]);
      expect(judgement.routing).toMatchObject({ answeredBy: { "decision-a": 1 }, escalated: 0 });
      expect(llmJudge.requests).toHaveLength(0);
    });

    /** @scenario "An unsure decision-model answer escalates to the LLM leg" */
    it("escalates an unsure answer, and the cost sums both calls", async () => {
      const { classify, llmJudge } = harness({ decisions: () => judged(0.4) });
      const judgement = await classify(SHORT);
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 1 }]);
      expect(judgement.routing).toMatchObject({ answeredBy: { "llm-b": 1 }, escalated: 1 });
      expect(llmJudge.requests[0]).toMatchObject({ wire: "openai_responses", job: "search" });
      // decision-a 1000 x 0.1 + llm-b 2000 x 1 + 100 x 5, in nano-USD per thousand tokens
      expect(judgement.costNanoUsd).toBe(100_000 + 2_000_000 + 500_000);
      expect(judgement.inputTokens).toBe(3000);
    });

    /** @scenario "An LLM leg that fails keeps the primary verdict, flagged" */
    it("keeps the unsure primary verdict when the escalation fails", async () => {
      const { classify } = harness({
        decisions: () => judged(0.4),
        llm: () => ({
          outcome: "skipped",
          reason: "classifier_provider_unavailable",
          inputTokens: 0,
          outputTokens: 0,
        }),
      });
      const judgement = await classify(SHORT);
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.4 }]);
      expect(judgement.routing?.flags).toEqual(
        expect.arrayContaining([
          "escalation_failed",
          "llm-b_failed:classifier_provider_unavailable",
        ]),
      );
      expect(judgement.routing?.escalated).toBe(0);
    });

    it("escalates every question when the primary and its fallback are down", async () => {
      const { classify } = harness({
        decisions: () => instantEvalSkipped("classifier_rate_limited"),
        jev: () => instantEvalSkipped("classifier_rate_limited"),
        llm: () => llmSays(false),
      });
      const judgement = await classify(SHORT);
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0 }]);
      expect(judgement.routing?.flags).toContain("primary_failed");
      expect(judgement.routing?.escalated).toBe(1);
    });

    /** @scenario "Nothing answered gives the last backend's skip reason" */
    it("skips with the platform's reason when every backend fails", async () => {
      const { classify } = harness({
        decisions: () => instantEvalSkipped("classifier_rate_limited"),
        jev: () => instantEvalSkipped("classifier_rate_limited"),
        llm: () => ({
          outcome: "skipped",
          reason: "classifier_key_invalid",
          inputTokens: 0,
          outputTokens: 0,
        }),
      });
      const judgement = await classify(SHORT);
      expect(judgement.verdicts).toEqual([]);
      expect(judgement.skippedReason).toBe("classifier_key_invalid");
    });
  });

  describe("given a plan that pairs two decision models", () => {
    /** @scenario "The confident pair keeps the more confident answer" */
    it("keeps the answer further from one half and pays for both", async () => {
      const { classify } = harness({ decisions: () => judged(0.55), jev: () => judged(0.1, 2000) });
      const judgement = await classify(PAIRED);
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.1 }]);
      expect(judgement.routing?.answeredBy).toEqual({ "decision-b": 1 });
      expect(judgement.costNanoUsd).toBe(100_000 + 100_000);
    });

    /** @scenario "The confident pair keeps the more confident answer" */
    it("keeps the primary on a tie, and the other leg when one is down", async () => {
      const tie = harness({ decisions: () => judged(0.9), jev: () => judged(0.1) });
      expect((await tie.classify(PAIRED)).routing?.answeredBy).toEqual({ "decision-a": 1 });
      const down = harness({
        decisions: () => instantEvalSkipped("classifier_provider_unavailable"),
        jev: () => judged(0.7),
      });
      const judgement = await down.classify(PAIRED);
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.7 }]);
      // The pair's fallback never calls the other leg's model a second time.
      expect(down.jevCalls()).toBe(1);
    });
  });

  describe("given a backend that is down", () => {
    /** @scenario "A backend that is down falls back to its configured fallback" */
    it("asks the backend's configured fallback and names the fallback taken", async () => {
      const { classify } = harness({ hasDecisions: false, jev: () => judged(0.2) });
      const judgement = await classify({ job: "search", tokens: 20_000, mode: "instant" });
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.2 }]);
      expect(judgement.routing?.flags).toEqual(
        expect.arrayContaining(["decision-a_unavailable", "fallback:decision-a->decision-b"]),
      );
    });

    it("rethrows the classifier's own refusal when nothing else answered, as unrouted calls do", async () => {
      const { classify } = harness({
        hasDecisions: false,
        jev: () => {
          throw new InstantEvalClassifierUnavailableError();
        },
      });
      await expect(classify({ job: "search", tokens: 20_000, mode: "instant" })).rejects.toThrow(
        InstantEvalClassifierUnavailableError,
      );
    });
  });

  describe("given a text-view plan", () => {
    /** @scenario "A text view the caller did not render judges the full text, flagged" */
    it("judges the full text and names the missing view", async () => {
      const { classify, hostedDecisions } = harness();
      const judgement = await classify({ ...SHORT, inputView: "text" });
      expect(hostedDecisions.requests[0]?.text).toBe("user: late again");
      expect(judgement.routing).toMatchObject({ inputView: "text" });
      expect(judgement.routing?.flags).toContain("text_view_missing");
    });

    /** @scenario "The text view is judged only by a decision model allowed to read it" */
    it("judges the rendered conversation, and escalates on the full trace", async () => {
      const { classify, hostedDecisions, llmJudge } = harness({ decisions: () => judged(0.5) });
      await classify({ ...SHORT, inputView: "text", views: { text: "user: late" } });
      expect(hostedDecisions.requests[0]?.text).toBe("user: late");
      expect(llmJudge.requests[0]?.text).toBe("user: late again");
    });

    /** @scenario "The text view is judged only by a decision model allowed to read it" */
    it("names a refused text view", async () => {
      const { classify } = harness();
      const judgement = await classify({
        ...PAIRED,
        inputView: "text",
        views: { text: "user: late" },
      });
      expect(judgement.routing).toMatchObject({ inputView: "full" });
      expect(judgement.routing?.flags).toContain("text_view_refused");
    });
  });

  it("sends a call with a score question to the hosted classifier unrouted", async () => {
    const { classify, hostedDecisions, jevCalls } = harness({ jev: () => judged(0.5) });
    const score: InstantEvalQuestion = {
      id: "s",
      kind: "score",
      instructions: "how polite",
      range: { min: 1, max: 5 },
    };
    const judgement = await classify(SHORT, [Q, score]);
    expect(jevCalls()).toBe(1);
    expect(hostedDecisions.requests).toHaveLength(0);
    expect(judgement.routing).toBeUndefined();
  });
});
