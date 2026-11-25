/**
 * The router under a judged query's cost ceiling (ADR-190 decision 13): each send holds its worst
 * case first, a send the ceiling cannot hold is not sent, and the hold becomes what was billed.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type {
  InstantEvalJudgeCostCeiling,
  InstantEvalJudgement,
  InstantEvalJudgeRoutePricing,
  InstantEvalJudgeRouteRequest,
  InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import { MemoryInstantEvalClassifierChannel } from "../../__tests__/support/instant-eval-classifier.test-fakes.ts";
import {
  rating,
  syntheticRouteTable,
  yesNo,
} from "../../__tests__/support/instant-eval-judge-route.test-fakes.ts";
import {
  ScriptedInstantEvalHostedDecisionsChannel,
  ScriptedInstantEvalLlmJudgeChannel,
} from "../../__tests__/support/instant-eval-judge-router.test-fakes.ts";
import { MemoryInstantEvalRateLimiter } from "../../__tests__/support/instant-eval-rate-limiter.test-fakes.ts";
import {
  instantEvalJudgeClassifierWorstCaseNanoUsd,
  instantEvalJudgeSendWorstCaseNanoUsd,
} from "../../rules/instant-eval-judge-route-cost.rules.ts";
import { InstantEvalJudgeRouterService } from "../instant-eval-judge-router.service.ts";

const Q = yesNo("q", "is the user upset");
const TEXT = "user: late again";
/** Short and balanced: Decisions first, the LLM below a sureness of 0.6. */
const SEARCH: InstantEvalJudgeRouteRequest = { job: "search", tokens: 500 };

const PRICING: InstantEvalJudgeRoutePricing = {
  version: "test",
  backends: {
    "decision-a": { usdPerMillionInputTokens: 0.1, usdPerMillionOutputTokens: 0 },
    "decision-b": { usdPerMillionInputTokens: 0.05, usdPerMillionOutputTokens: 0 },
    "llm-a": { usdPerMillionInputTokens: 2, usdPerMillionOutputTokens: 8 },
    "llm-b": { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 5 },
  },
};

/** 1,000 input tokens at decision-a's 0.1 per million. */
const DECISION_COST_NANO_USD = 100_000;

/** A ceiling that keeps what it was asked, with the same arithmetic as a query's. */
class RecordingCeiling implements InstantEvalJudgeCostCeiling {
  readonly holds: number[] = [];
  readonly refused: number[] = [];
  readonly settled: { heldNanoUsd: number; costNanoUsd: number }[] = [];
  held = 0;
  billed = 0;

  constructor(private readonly ceilingNanoUsd: number) {}

  hold(nanoUsd: number): boolean {
    if (!Number.isFinite(nanoUsd) || this.billed + this.held + nanoUsd > this.ceilingNanoUsd) {
      this.refused.push(nanoUsd);
      return false;
    }
    this.held += nanoUsd;
    this.holds.push(nanoUsd);
    return true;
  }

  settle(input: { heldNanoUsd: number; costNanoUsd: number }): void {
    this.held -= input.heldNanoUsd;
    this.billed += input.costNanoUsd;
    this.settled.push(input);
  }
}

function judged(probability: number): InstantEvalJudgement {
  return {
    verdicts: [{ questionId: Q.id, probability }],
    inputTokens: 1000,
    isTextTruncated: false,
  };
}

function harness({ decisionProbability = 0.5 }: { decisionProbability?: number } = {}) {
  const table = syntheticRouteTable();
  const hostedDecisions = ScriptedInstantEvalHostedDecisionsChannel.create({
    answer: () => judged(decisionProbability),
  });
  const llmJudge = ScriptedInstantEvalLlmJudgeChannel.create({
    answer: () => ({ outcome: "answered", verdict: true, inputTokens: 2000, outputTokens: 100 }),
  });
  let jevCalls = 0;
  const classifier = MemoryInstantEvalClassifierChannel.create({
    answer: async () => {
      jevCalls += 1;
      return judged(0.5);
    },
  });
  const router = InstantEvalJudgeRouterService.create({
    table,
    pricing: PRICING,
    classifier,
    hostedDecisions,
    llmJudge,
    limiter: MemoryInstantEvalRateLimiter.create(),
  });
  const classify = (costCeiling: InstantEvalJudgeCostCeiling, questions: InstantEvalQuestion[]) =>
    router.classify({ projectId: "project-1", text: TEXT, questions, route: SEARCH, costCeiling });
  const worstOf = (backend: string, questions: InstantEvalQuestion[] = [Q]) =>
    instantEvalJudgeSendWorstCaseNanoUsd({
      backend,
      table,
      pricing: PRICING,
      job: "search",
      text: TEXT,
      questions,
    });
  return { classify, hostedDecisions, llmJudge, jevCalls: () => jevCalls, worstOf, table };
}

describe("InstantEvalJudgeRouterService under a cost ceiling", () => {
  /** @scenario "Under a cost ceiling each send holds its worst case first" */
  it("holds each send's worst case before it is sent and settles it with what it billed", async () => {
    const { classify, worstOf } = harness();
    const ceiling = new RecordingCeiling(1_000_000_000);

    const judgement = await classify(ceiling, [Q]);

    expect(ceiling.holds).toEqual([worstOf("decision-a"), worstOf("llm-b")]);
    expect(ceiling.settled.map((s) => s.heldNanoUsd)).toEqual(ceiling.holds);
    expect(ceiling.billed).toBe(judgement.costNanoUsd);
    expect(ceiling.held).toBe(0);
    expect(judgement.routing?.escalated).toBe(1);
  });

  /** @scenario "A send whose worst case passes the ceiling is not sent" */
  it("keeps the unsure primary verdict, flagged, when the escalation's worst case does not fit", async () => {
    const { classify, llmJudge, worstOf } = harness();
    const ceiling = new RecordingCeiling(worstOf("decision-a"));

    const judgement = await classify(ceiling, [Q]);

    expect(llmJudge.requests).toHaveLength(0);
    expect(ceiling.refused).toEqual([worstOf("llm-b")]);
    expect(judgement.verdicts).toEqual([{ questionId: Q.id, probability: 0.5 }]);
    expect(judgement.routing?.flags).toEqual(
      expect.arrayContaining(["cost_ceiling:llm-b", "escalation_failed"]),
    );
    expect(judgement.costNanoUsd).toBe(DECISION_COST_NANO_USD);
    expect(ceiling.billed).toBe(DECISION_COST_NANO_USD);
  });

  /** @scenario "A send whose worst case passes the ceiling is not sent" */
  it("sends nothing and skips the text as rate limited when no backend's worst case fits", async () => {
    const { classify, hostedDecisions, llmJudge, jevCalls, worstOf } = harness();
    // Below the primary and its cheaper Jev fallback alike.
    const ceiling = new RecordingCeiling(
      Math.min(worstOf("decision-a"), worstOf("decision-b")) - 1,
    );

    const judgement = await classify(ceiling, [Q]);

    expect(hostedDecisions.requests).toHaveLength(0);
    expect(llmJudge.requests).toHaveLength(0);
    expect(jevCalls()).toBe(0);
    expect(judgement.skippedReason).toBe("classifier_rate_limited");
    expect(judgement.verdicts).toEqual([]);
    expect(ceiling.billed).toBe(0);
    expect(ceiling.holds).toEqual([]);
  });

  /** @scenario "A send whose worst case passes the ceiling is not sent" */
  it("asks the primary's cheaper fallback when only the fallback's worst case fits", async () => {
    const { classify, hostedDecisions, jevCalls, worstOf } = harness();
    const ceiling = new RecordingCeiling(worstOf("decision-b"));

    const judgement = await classify(ceiling, [Q]);

    expect(hostedDecisions.requests).toHaveLength(0);
    expect(jevCalls()).toBe(1);
    expect(judgement.routing?.flags).toEqual(
      expect.arrayContaining(["cost_ceiling:decision-a", "fallback:decision-a->decision-b"]),
    );
  });

  /** @scenario "A kind the table does not route holds the classifier's worst case too" */
  it("does not call the classifier for an unrouted kind whose worst case does not fit", async () => {
    const { classify, jevCalls, table } = harness();
    const score = rating("s", "how polite");
    const worst = instantEvalJudgeClassifierWorstCaseNanoUsd({
      table,
      pricing: PRICING,
      job: "search",
      text: TEXT,
      questions: [score],
    });

    const refused = await classify(new RecordingCeiling(worst - 1), [score]);
    const room = new RecordingCeiling(worst);
    const answered = await classify(room, [score]);

    expect(refused.skippedReason).toBe("classifier_rate_limited");
    expect(jevCalls()).toBe(1);
    expect(answered.skippedReason).toBeUndefined();
    expect(room.holds).toEqual([worst]);
    expect(room.billed).toBe(answered.costNanoUsd);
  });
});
