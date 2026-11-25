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
import { describe, expect, it, vi } from "vitest";

import { MemoryInstantEvalClassifierChannel } from "../../__tests__/support/instant-eval-classifier.test-fakes.ts";
import {
  gatedRouteTable,
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
  instantEvalJudgeGateInputOf,
  instantEvalJudgeGateQuestionOf,
} from "../../rules/instant-eval-judge-gate.rules.ts";
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
    "gate-a": { usdPerMillionInputTokens: 0.05, usdPerMillionOutputTokens: 0 },
    "decision-a": { usdPerMillionInputTokens: 0.1, usdPerMillionOutputTokens: 0 },
    "decision-b": { usdPerMillionInputTokens: 0.05, usdPerMillionOutputTokens: 0 },
    "llm-a": { usdPerMillionInputTokens: 2, usdPerMillionOutputTokens: 8 },
    "llm-b": { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 5 },
  },
};

/** 1,000 input tokens at decision-a's 0.1 per million. */
const DECISION_COST_NANO_USD = 100_000;

/** A judged query's cost ceiling on the default budget: 0.60 USD in cost (ADR-190 decision 13). */
const QUERY_CEILING_NANO_USD = 600_000_000;

/** A ceiling that keeps what it was asked, with the same arithmetic as a query's. */
class RecordingCeiling implements InstantEvalJudgeCostCeiling {
  readonly holds: number[] = [];
  readonly refused: number[] = [];
  readonly settled: { heldNanoUsd: number; costNanoUsd: number }[] = [];
  held = 0;
  billed = 0;

  constructor(private readonly ceilingNanoUsd: number) {}

  async hold(nanoUsd: number): Promise<boolean> {
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

function harness({
  decisionProbability = 0.5,
  table = syntheticRouteTable(),
  text = TEXT,
}: {
  decisionProbability?: number;
  table?: ReturnType<typeof syntheticRouteTable>;
  text?: string;
} = {}) {
  const hostedDecisions = ScriptedInstantEvalHostedDecisionsChannel.create({
    answer: (request) => ({
      ...judged(decisionProbability),
      verdicts: request.questions.map((q) => ({
        questionId: q.id,
        probability: decisionProbability,
      })),
    }),
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
  const logger = { error: vi.fn(), warn: vi.fn() };
  const router = InstantEvalJudgeRouterService.create({
    table,
    pricing: PRICING,
    classifier,
    hostedDecisions,
    llmJudge,
    limiter: MemoryInstantEvalRateLimiter.create(),
    logger,
  });
  const classify = (costCeiling: InstantEvalJudgeCostCeiling, questions: InstantEvalQuestion[]) =>
    router.classify({ projectId: "project-1", text, questions, route: SEARCH, costCeiling });
  const worstOf = (
    backend: string,
    questions: InstantEvalQuestion[] = [Q],
    sent: string = text,
  ): number =>
    instantEvalJudgeSendWorstCaseNanoUsd({
      backend,
      table,
      pricing: PRICING,
      job: "search",
      text: sent,
      questions,
    });
  return { classify, hostedDecisions, llmJudge, jevCalls: () => jevCalls, worstOf, table, logger };
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
  it("sends nothing and skips the text on the query cost ceiling when no backend's worst case fits", async () => {
    const { classify, hostedDecisions, llmJudge, jevCalls, worstOf } = harness();
    // Below the primary and its cheaper Jev fallback alike.
    const ceiling = new RecordingCeiling(
      Math.min(worstOf("decision-a"), worstOf("decision-b")) - 1,
    );

    const judgement = await classify(ceiling, [Q]);

    expect(hostedDecisions.requests).toHaveLength(0);
    expect(llmJudge.requests).toHaveLength(0);
    expect(jevCalls()).toBe(0);
    expect(judgement.skippedReason).toBe("query_cost_ceiling");
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
  it("does not call the classifier for an unrouted kind whose worst case does not fit, and logs it", async () => {
    const { classify, jevCalls, table, logger } = harness();
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

    expect(refused.skippedReason).toBe("query_cost_ceiling");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { projectId: "project-1", job: "search", heldNanoUsd: worst },
      "Instant Evals unrouted send refused by the query cost ceiling",
    );
    expect(jevCalls()).toBe(1);
    expect(answered.skippedReason).toBeUndefined();
    expect(room.holds).toEqual([worst]);
    expect(room.billed).toBe(answered.costNanoUsd);
  });

  /** @scenario "Under a cost ceiling each send holds its worst case first" */
  it("holds a long trace at what its channel can send, so three questions fit the query ceiling", async () => {
    // About 2 MB: unfitted, Decisions would hold 0.20 USD a question, the whole 0.60 USD ceiling.
    const longText = `user: ${"the parcel came late again and nobody answered. ".repeat(42_000)}`;
    const questions = [Q, yesNo("q2", "is the user confused"), yesNo("q3", "did the agent help")];
    const { classify, hostedDecisions, worstOf } = harness({
      decisionProbability: 0.95,
      text: longText,
    });
    const ceiling = new RecordingCeiling(QUERY_CEILING_NANO_USD);

    const judgement = await classify(ceiling, questions);

    expect(ceiling.refused).toEqual([]);
    expect(ceiling.holds).toEqual([worstOf("decision-a", questions)]);
    expect(ceiling.holds[0]).toBeLessThan(QUERY_CEILING_NANO_USD / 20);
    expect(hostedDecisions.requests).toHaveLength(1);
    expect(judgement.skippedReason).toBeUndefined();
    expect(judgement.verdicts).toHaveLength(3);
    expect(judgement.routing?.flags ?? []).not.toContain("cost_ceiling:decision-a");
  });
});

describe("InstantEvalJudgeRouterService under a cost ceiling, given a gated plan", () => {
  /** A gate dearer per byte than the primary: a ceiling can hold the primary and not the gate. */
  const GATED_PRICING: InstantEvalJudgeRoutePricing = {
    version: "test",
    backends: {
      ...PRICING.backends,
      "gate-a": { usdPerMillionInputTokens: 0.2, usdPerMillionOutputTokens: 0 },
    },
  };

  const gated = (gateScore: number) => {
    const table = gatedRouteTable();
    const gateRequests: InstantEvalQuestion[][] = [];
    const classifier = MemoryInstantEvalClassifierChannel.create({
      answer: async (request) => {
        gateRequests.push([...request.questions]);
        return {
          verdicts: [{ questionId: request.questions[0]!.id, score: gateScore }],
          inputTokens: 400,
          isTextTruncated: false,
        };
      },
    });
    const hostedDecisions = ScriptedInstantEvalHostedDecisionsChannel.create({
      answer: () => judged(0.5),
    });
    const llmJudge = ScriptedInstantEvalLlmJudgeChannel.create({
      answer: () => ({ outcome: "answered", verdict: true, inputTokens: 2000, outputTokens: 100 }),
    });
    const router = InstantEvalJudgeRouterService.create({
      table,
      pricing: GATED_PRICING,
      classifier,
      hostedDecisions,
      llmJudge,
      limiter: MemoryInstantEvalRateLimiter.create(),
      logger: { error: () => undefined, warn: () => undefined },
    });
    const classify = (costCeiling: InstantEvalJudgeCostCeiling) =>
      router.classify({
        projectId: "project-1",
        text: TEXT,
        questions: [Q],
        route: SEARCH,
        costCeiling,
      });
    const worstOf = (backend: string, text: string, questions: InstantEvalQuestion[]) =>
      instantEvalJudgeSendWorstCaseNanoUsd({
        backend,
        table,
        pricing: GATED_PRICING,
        job: "search",
        text,
        questions,
      });
    const gateWorst = worstOf(
      "gate-a",
      instantEvalJudgeGateInputOf({ job: "search", task: Q.instructions, text: TEXT }),
      [instantEvalJudgeGateQuestionOf({ name: "difficulty_v1", id: Q.id })],
    );
    return { classify, gateRequests, hostedDecisions, llmJudge, worstOf, gateWorst };
  };

  /** @scenario "Under a cost ceiling each send holds its worst case first" */
  it("holds the gate's worst case on its own framed text, then the branch's, and settles both", async () => {
    const { classify, gateRequests, hostedDecisions, worstOf, gateWorst } = gated(0);
    const ceiling = new RecordingCeiling(QUERY_CEILING_NANO_USD);

    const judgement = await classify(ceiling);

    expect(gateRequests).toHaveLength(1);
    expect(hostedDecisions.requests).toHaveLength(1);
    expect(ceiling.holds).toEqual([gateWorst, worstOf("decision-a", TEXT, [Q])]);
    // The framed text is longer than the row's, so the gate is not held on the row's text.
    expect(gateWorst).not.toBe(worstOf("gate-a", TEXT, gateRequests[0]!));
    expect(ceiling.settled.map((s) => s.heldNanoUsd)).toEqual(ceiling.holds);
    expect(ceiling.held).toBe(0);
    expect(ceiling.billed).toBe(judgement.costNanoUsd);
    expect(judgement.routing?.flags).toEqual(["gate:easy"]);
  });

  /** @scenario "Under a cost ceiling each send holds its worst case first" */
  it("sends no gate the ceiling cannot hold, so the question goes the hard way within the ceiling", async () => {
    const { classify, gateRequests, hostedDecisions, llmJudge, worstOf, gateWorst } = gated(0);
    // Room for the primary on the row's text, not for the gate on its framed one.
    const room = gateWorst - 1;
    expect(worstOf("decision-a", TEXT, [Q])).toBeLessThanOrEqual(room);
    expect(worstOf("llm-b", TEXT, [Q])).toBeGreaterThan(room);
    const ceiling = new RecordingCeiling(room);

    const judgement = await classify(ceiling);

    expect(gateRequests).toHaveLength(0);
    expect(llmJudge.requests).toHaveLength(0);
    expect(judgement.routing?.flags).toEqual([
      "cost_ceiling:gate-a",
      "gate-a_failed:query_cost_ceiling",
      "gate_no_score",
      "gate:hard",
      "cost_ceiling:llm-b",
      "llm-b_failed:query_cost_ceiling",
      "gate_hard_failed",
    ]);
    // The hard branch's escalation did not fit, so the primary answered the question.
    expect(hostedDecisions.requests).toHaveLength(1);
    expect(judgement.verdicts).toEqual([{ questionId: Q.id, probability: 0.5 }]);
    expect(ceiling.refused).toEqual([gateWorst, worstOf("llm-b", TEXT, [Q])]);
    expect(ceiling.billed).toBe(DECISION_COST_NANO_USD);
    expect(ceiling.billed).toBeLessThanOrEqual(room);
    expect(ceiling.held).toBe(0);
  });
});
