/**
 * The judge call's fixed order (ADR-174 decisions 8, 9, 12, 14, 15): cloud only, unknown project,
 * budget, classify, price, priced fact. Refusals are returned and call no classifier.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import {
  INSTANT_EVAL_PRICING,
  InstantEvalJudgeStoppedError,
  type InstantEvalJudgement,
  type InstantEvalJudgeSpendPricedEventData,
  type InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryInstantEvalClassifierChannel } from "../../__tests__/support/instant-eval-classifier.test-fakes.ts";
import { ScriptedInstantEvalDecisionModelChannel } from "../../__tests__/support/instant-eval-decision-model.test-fakes.ts";
import { syntheticRouteTable } from "../../__tests__/support/instant-eval-judge-route.test-fakes.ts";
import {
  publicInstantEvalJudgeRouter,
  ScriptedInstantEvalHostedDecisionsChannel,
  ScriptedInstantEvalLlmJudgeChannel,
} from "../../__tests__/support/instant-eval-judge-router.test-fakes.ts";
import { MemoryInstantEvalRateLimiter } from "../../__tests__/support/instant-eval-rate-limiter.test-fakes.ts";
import type { InstantEvalClassifyRequest } from "../../channels/instant-eval-classifier.channel.ts";
import { MemoryInstantEvalDecisionModelChannel } from "../../channels/memory/memory.instant-eval-decision-model.channel.ts";
import {
  MemoryInstantEvalJudgeProjectRepository,
  MemoryInstantEvalJudgeRepositories,
} from "../../repositories/memory/memory.instant-eval-judge.repositories.ts";
import { instantEvalJudgeSpendPricedOf } from "../../rules/instant-eval-judge-spend.rules.ts";
import { InstantEvalJudgeRouterService } from "../instant-eval-judge-router.service.ts";
import { InstantEvalJudgeService } from "../instant-eval-judge.service.ts";

const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";
const NOW = 1_760_000_000_000;
const NANO_PER_USD = 1_000_000_000n;
const ONE_DOLLAR = NANO_PER_USD;

const QUESTION: InstantEvalQuestion = {
  id: "verdict",
  kind: "boolean",
  instructions: "The output answers the input",
};

function answered(inputTokens: number): InstantEvalJudgement {
  return {
    verdicts: [{ questionId: QUESTION.id, probability: 0.9 }],
    inputTokens,
    isTextTruncated: false,
  };
}

type Classify = (
  request: InstantEvalClassifyRequest,
  signal?: AbortSignal,
) => Promise<InstantEvalJudgement>;

function harness({
  isCloud = true,
  hasClassifier = true,
  classify = async () => answered(500),
  isProjectKnown = true,
  usageBilled,
  spentNanoUsd = 0n,
  routeUsdPerMillion = 1,
}: {
  isCloud?: boolean;
  hasClassifier?: boolean;
  classify?: Classify;
  isProjectKnown?: boolean;
  /** Absent leaves the organization never folded, which reads as not billed. */
  usageBilled?: boolean;
  spentNanoUsd?: bigint;
  /** The Decisions backend's price; zero is a valid, self-hosted price. */
  routeUsdPerMillion?: number;
} = {}) {
  const repositories = {
    ...MemoryInstantEvalJudgeRepositories.create(),
    // Project's and organization's tables, stood in: the project is placed or it is not.
    projects: MemoryInstantEvalJudgeProjectRepository.create({
      rows: new Map(isProjectKnown ? [[PROJECT_ID, { organizationId: ORGANIZATION_ID }]] : []),
    }),
  };
  const classifier = MemoryInstantEvalClassifierChannel.create({ answer: classify });
  const classifySpy = vi.spyOn(classifier, "classify");
  const recorded: InstantEvalJudgeSpendPricedEventData[] = [];
  const { logger, lines } = createTestLogger();
  let minted = 0;
  const decisionModels = ScriptedInstantEvalDecisionModelChannel.create({
    answer: () => ({
      verdicts: [{ questionId: QUESTION.id, probability: 0.7 }],
      inputTokens: 0,
      isTextTruncated: false,
    }),
  });
  const limiter = MemoryInstantEvalRateLimiter.create();
  const routePricing = {
    version: "test",
    backends: {
      "decision-a": { usdPerMillionInputTokens: routeUsdPerMillion, usdPerMillionOutputTokens: 0 },
    },
  };
  const router = InstantEvalJudgeRouterService.create({
    table: syntheticRouteTable(),
    pricing: routePricing,
    classifier,
    hostedDecisions: ScriptedInstantEvalHostedDecisionsChannel.create({
      answer: () => ({
        verdicts: [{ questionId: QUESTION.id, probability: 0.05 }],
        inputTokens: 1_000_000,
        isTextTruncated: false,
      }),
    }),
    llmJudge: ScriptedInstantEvalLlmJudgeChannel.create({
      answer: () => ({ outcome: "answered", verdict: true, inputTokens: 1, outputTokens: 1 }),
    }),
    limiter,
  });
  const service = InstantEvalJudgeService.create({
    decisionModels,
    repositories,
    classifier: hasClassifier ? classifier : undefined,
    // A router over a synthetic table whose LLM leg answers yes; only a call with a route uses it.
    router,
    routePricing,
    limiter,
    isCloud,
    // The spend pipeline's subscriber, stood in: one row per request, never rewritten.
    recordSpendPriced: async (fact) => {
      recorded.push(fact);
      await repositories.spend.create({
        organizationId: fact.organizationId,
        requestId: fact.requestId,
        spendNanoUsd: BigInt(fact.priceNanoUsd),
        occurredAtMs: fact.occurredAt,
      });
    },
    mintRequestId: () => `minted-${++minted}`,
    now: () => Temporal.Instant.fromEpochMilliseconds(NOW),
    logger,
  });
  const seed = async () => {
    if (usageBilled !== undefined) {
      await repositories.usageBilling.upsert({
        organizationId: ORGANIZATION_ID,
        usageBilled,
        occurredAtMs: 1,
        fromCatchUp: false,
      });
    }
    if (spentNanoUsd > 0n) {
      await repositories.spend.create({
        organizationId: ORGANIZATION_ID,
        requestId: "earlier",
        spendNanoUsd: spentNanoUsd,
        occurredAtMs: 1,
      });
    }
  };
  return {
    service,
    router,
    classifier: { classify: classifySpy },
    decisionModels,
    recorded,
    repositories,
    lines,
    seed,
  };
}

const call = { projectId: PROJECT_ID, text: "Input: hi\nOutput: hello", questions: [QUESTION] };

describe("given a judge call on LangWatch cloud", () => {
  describe("when the judge has not learned the project", () => {
    /** @scenario "A project the judge does not know yet is refused, never judged free" */
    it("refuses it as unknown, returned rather than thrown, and calls no classifier", async () => {
      const { service, classifier, recorded, seed, lines } = harness({ isProjectKnown: false });
      await seed();

      const answer = await service.judge(call);

      expect(answer).toMatchObject({ outcome: "refused", code: "instant_eval_project_unknown" });
      expect(classifier.classify).not.toHaveBeenCalled();
      expect(recorded).toEqual([]);
      const line = lines.findLine("warn", "project:record-created-facts");
      expect(line?.projectId).toBe(PROJECT_ID);
    });
  });

  describe("when a free organization has spent one dollar", () => {
    /** @scenario "A free organization past one dollar is refused before classifying" */
    it("refuses it with the free budget exhausted error and calls no classifier", async () => {
      const { service, classifier, seed } = harness({ spentNanoUsd: ONE_DOLLAR });
      await seed();

      const answer = await service.judge(call);

      expect(answer).toMatchObject({
        outcome: "refused",
        code: "instant_eval_free_budget_exhausted",
      });
      expect(classifier.classify).not.toHaveBeenCalled();
    });
  });

  describe("when a paid organization on tiered pricing has spent one dollar", () => {
    /** @scenario "A paid organization on tiered pricing is capped at one dollar" */
    it("refuses it with the free budget exhausted error", async () => {
      const { service, classifier, seed } = harness({
        usageBilled: false,
        spentNanoUsd: ONE_DOLLAR,
      });
      await seed();

      const answer = await service.judge(call);

      expect(answer).toMatchObject({
        outcome: "refused",
        code: "instant_eval_free_budget_exhausted",
      });
      expect(answer.outcome === "refused" && answer.message).not.toMatch(/upgrade|paid plan/i);
      expect(classifier.classify).not.toHaveBeenCalled();
    });
  });

  describe("when an organization the meter bills has spent one dollar", () => {
    /** @scenario "A usage-billed organization is not capped" */
    it("classifies it", async () => {
      const { service, classifier, seed } = harness({
        usageBilled: true,
        spentNanoUsd: 5n * ONE_DOLLAR,
      });
      await seed();

      const answer = await service.judge(call);

      expect(answer.outcome).toBe("judged");
      expect(classifier.classify).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a free organization at $0.99 makes a call priced $0.05", () => {
    /** @scenario "A judge call that crosses one dollar is recorded in full" */
    it("records the whole price, past the dollar", async () => {
      const inputTokens = 915_751;
      const { service, recorded, repositories, seed } = harness({
        spentNanoUsd: (99n * NANO_PER_USD) / 100n,
        classify: async () => answered(inputTokens),
      });
      await seed();

      await service.judge(call);

      const [fact] = recorded;
      expect(fact?.priceNanoUsd).toBeCloseTo(50_000_000, -4);
      const { spendNanoUsd } = await repositories.spend.getTotal({
        organizationId: ORGANIZATION_ID,
      });
      expect(spendNanoUsd).toBe((99n * NANO_PER_USD) / 100n + BigInt(fact?.priceNanoUsd ?? 0));
    });
  });

  describe("when two calls arrive together one millionth of a dollar under the dollar", () => {
    /** @scenario "Two judge calls that arrive together just under one dollar are both answered" */
    it("answers both and records both", async () => {
      const { service, classifier, recorded, seed } = harness({
        spentNanoUsd: ONE_DOLLAR - 1_000n,
        classify: async () => answered(500),
      });
      await seed();

      const answers = await Promise.all([service.judge(call), service.judge(call)]);

      expect(answers.map((answer) => answer.outcome)).toEqual(["judged", "judged"]);
      expect(classifier.classify).toHaveBeenCalledTimes(2);
      expect(recorded).toHaveLength(2);
      expect(recorded.every((fact) => fact.priceNanoUsd > 1_000)).toBe(true);
    });
  });
});

describe("given a judge call off LangWatch cloud", () => {
  describe("when a classifier key is set", () => {
    /** @scenario "Off LangWatch cloud a judge call is not configured" */
    it("answers it as classifier not configured and calls no classifier", async () => {
      const { service, classifier, seed } = harness({ isCloud: false });
      await seed();

      const answer = await service.judge(call);

      expect(answer).toMatchObject({ outcome: "refused", code: "classifier_not_configured" });
      expect(classifier.classify).not.toHaveBeenCalled();
    });
  });

  describe("when the judge has not learned the project either", () => {
    it("answers it as not configured, with no log asking for the project catch-up", async () => {
      const { service, seed, lines } = harness({ isCloud: false, isProjectKnown: false });
      await seed();

      const answer = await service.judge(call);

      expect(answer).toMatchObject({ outcome: "refused", code: "classifier_not_configured" });
      expect(lines.findLine("warn", "project:record-created-facts")).toBeUndefined();
    });
  });
});

describe("given a judge call the classifier answers", () => {
  describe("when it classified five hundred input tokens", () => {
    it("answers the customer price beside the verdict, and records that price", async () => {
      const { service, recorded, seed } = harness();
      await seed();

      const answer = await service.judge(call);

      const expected = instantEvalJudgeSpendPricedOf({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        requestId: "minted-1",
        inputTokens: 500,
        occurredAt: NOW,
      });
      expect(answer).toMatchObject({ outcome: "judged", priceUsd: expected.priceUsd });
      expect(recorded).toEqual([expected.fact]);
    });
  });

  describe("when the classifier skipped it", () => {
    /** @scenario "A judge call that used no tokens records nothing" */
    it("records no spend", async () => {
      const { service, recorded, seed } = harness({
        classify: async () => ({
          verdicts: [],
          skippedReason: "classifier_input_too_large",
          inputTokens: 0,
          isTextTruncated: false,
        }),
      });
      await seed();

      const answer = await service.judge(call);

      expect(answer).toMatchObject({ outcome: "judged", priceUsd: 0 });
      expect(recorded).toEqual([]);
    });
  });

  describe("when two calls carry the same retry key", () => {
    /** @scenario "The same retry key gives the same spend id" */
    it("records both under the same request id", async () => {
      const { service, recorded, seed } = harness();
      await seed();
      const requestKey = "project-1:evaluation-1:execution";

      await service.judge({ ...call, requestKey });
      await service.judge({ ...call, requestKey });

      expect(recorded.map((fact) => fact.requestId)).toEqual([
        `instantevaljudge_${requestKey}`,
        `instantevaljudge_${requestKey}`,
      ]);
    });
  });

  describe("when two calls carry no retry key", () => {
    /** @scenario "A judge call with no retry key gets a fresh spend id" */
    it("records them under different request ids", async () => {
      const { service, recorded, seed } = harness();
      await seed();

      await service.judge(call);
      await service.judge(call);

      const [first, second] = recorded.map((fact) => fact.requestId);
      expect(first).not.toBe(second);
    });
  });

  describe("when the caller cancels after the classifier answered", () => {
    /** @scenario "A judge call cancelled after the classifier answered still records its spend" */
    it("still records one spend row", async () => {
      const controller = new AbortController();
      const { service, recorded, repositories, seed } = harness({
        classify: async () => {
          controller.abort();
          return answered(500);
        },
      });
      await seed();

      await service.judge({ ...call, signal: controller.signal });

      expect(recorded).toHaveLength(1);
      const { spendNanoUsd } = await repositories.spend.getTotal({
        organizationId: ORGANIZATION_ID,
      });
      expect(spendNanoUsd).toBe(BigInt(recorded[0]?.priceNanoUsd ?? -1));
    });
  });

  describe("when its priced fact cannot be appended", () => {
    it("logs it and keeps the verdict", async () => {
      const repositories = {
        ...MemoryInstantEvalJudgeRepositories.create(),
        projects: MemoryInstantEvalJudgeProjectRepository.create({
          rows: new Map([[PROJECT_ID, { organizationId: ORGANIZATION_ID }]]),
        }),
      };
      const { logger, lines } = createTestLogger();
      const classifier = { classify: async () => answered(500) };
      const limiter = MemoryInstantEvalRateLimiter.create();
      const service = InstantEvalJudgeService.create({
        decisionModels: MemoryInstantEvalDecisionModelChannel.create(),
        repositories,
        limiter,
        classifier,
        ...publicInstantEvalJudgeRouter({ classifier, limiter }),
        isCloud: true,
        recordSpendPriced: async () => {
          throw new Error("queue down");
        },
        mintRequestId: () => "minted",
        now: () => Temporal.Instant.fromEpochMilliseconds(NOW),
        logger,
      });

      const answer = await service.judge(call);

      expect(answer.outcome).toBe("judged");
      expect(lines.findLine("error", "could not be recorded")?.requestId).toBe("minted");
    });
  });
});

describe("given an Instant Evals run's spend, for a project the judge has not learned", () => {
  const record = {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    requestId: "instanteval_run-1",
    inputTokens: 2_000,
    requests: 40,
    runId: "run-1",
    occurredAt: NOW,
  };

  describe("when it is recorded through the judge", () => {
    it("appends one priced fact under the organization it was given, reading no project and no budget", async () => {
      const { service, recorded, repositories, classifier, seed } = harness({
        isProjectKnown: false,
      });
      await seed();
      const placement = vi.spyOn(repositories.projects, "getPlacement");
      const total = vi.spyOn(repositories.spend, "getTotal");

      await service.recordSpend(record);

      const { fact } = instantEvalJudgeSpendPricedOf({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        requestId: "instanteval_run-1",
        inputTokens: 2_000,
        occurredAt: NOW,
      });
      expect(recorded).toEqual([{ ...fact, requests: 40, runId: "run-1" }]);
      expect(placement).not.toHaveBeenCalled();
      expect(total).not.toHaveBeenCalled();
      expect(classifier.classify).not.toHaveBeenCalled();
    });
  });

  describe("when it judged no tokens", () => {
    it("records nothing", async () => {
      const { service, recorded } = harness();

      await service.recordSpend({ ...record, inputTokens: 0 });

      expect(recorded).toEqual([]);
    });
  });

  describe("when the priced fact cannot be stored", () => {
    it("throws, so the run's finish retries onto the same request id", async () => {
      const limiter = MemoryInstantEvalRateLimiter.create();
      const service = InstantEvalJudgeService.create({
        decisionModels: MemoryInstantEvalDecisionModelChannel.create(),
        repositories: MemoryInstantEvalJudgeRepositories.create(),
        limiter,
        classifier: undefined,
        ...publicInstantEvalJudgeRouter({ classifier: undefined, limiter }),
        isCloud: true,
        recordSpendPriced: async () => {
          throw new Error("queue down");
        },
        mintRequestId: () => "minted",
        now: () => Temporal.Instant.fromEpochMilliseconds(NOW),
      });

      await expect(service.recordSpend(record)).rejects.toThrow(/queue down/);
    });
  });
});

describe("given a judge call on an own decision model", () => {
  const decisionModel = {
    model: "inception/decisions:mercury-decide",
    wire: "jev" as const,
    providerModel: "mercury-decide",
    endpoint: "https://api.inceptionlabs.ai/v1/decisions",
    apiKey: "customer-key",
  };

  describe("when the project is unknown, the install is not cloud and the budget is spent", () => {
    /** @scenario "An LLM judge on an own decision model is not metered or capped" */
    it("judges through the own model at no price and records nothing", async () => {
      const { service, classifier, decisionModels, recorded, seed } = harness({
        isCloud: false,
        isProjectKnown: false,
        spentNanoUsd: 5_000_000_000n,
      });
      await seed();

      const answer = await service.judge({ ...call, decisionModel });

      expect(answer).toMatchObject({ outcome: "judged", priceUsd: 0 });
      expect(decisionModels.requests).toHaveLength(1);
      expect(decisionModels.requests[0]?.decisionModel).toEqual(decisionModel);
      expect(classifier.classify).not.toHaveBeenCalled();
      expect(recorded).toEqual([]);
    });
  });
});

describe("given a judge call that carries a route", () => {
  /** @scenario "A routed judgement is priced from the summed cost of every call" */
  it("prices the summed cost at the one published markup, under the router's model and rate", async () => {
    const { service, classifier, recorded, seed } = harness();
    await seed();

    const answer = await service.judge({ ...call, route: { job: "llm_judge", tokens: 100 } });

    // One million Decisions tokens at $1 per million, at the published markup.
    expect(answer).toMatchObject({ outcome: "judged", priceUsd: INSTANT_EVAL_PRICING.markup });
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      model: "langwatch-judge",
      rateVersion: `instant_eval_judge_router@testx${INSTANT_EVAL_PRICING.markup}`,
      costNanoUsd: 1_000_000_000,
      priceNanoUsd: INSTANT_EVAL_PRICING.markup * 1_000_000_000,
      inputTokens: 1_000_000,
    });
  });

  /** @scenario "A call with no route keeps today's single classifier call" */
  it("keeps today's single classifier call and token price when no route is sent", async () => {
    const { service, classifier, recorded, seed } = harness();
    await seed();

    const answer = await service.judge(call);

    expect(classifier.classify).toHaveBeenCalledTimes(1);
    expect(answer).toMatchObject({ outcome: "judged" });
    const { judgement } = answer as Extract<typeof answer, { outcome: "judged" }>;
    expect(judgement.routing).toBeUndefined();
    expect(judgement.costNanoUsd).toBeUndefined();
    expect(recorded[0]).toMatchObject({ model: "jev", inputTokens: 500 });
  });

  /** @scenario "A routed judgement is priced from the summed cost of every call" */
  it("records a run's routed spend from its summed cost", async () => {
    const { service, recorded } = harness();

    await service.recordSpend({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      requestId: "run-1",
      inputTokens: 10,
      costNanoUsd: 500,
      routedInputTokens: 10,
      requests: 1,
      occurredAt: NOW,
    });

    expect(recorded[0]).toMatchObject({
      costNanoUsd: 500,
      priceNanoUsd: Math.round(500 * INSTANT_EVAL_PRICING.markup),
      model: "langwatch-judge",
    });
  });

  /** @scenario "A caller's stop keeps the legs already paid billed" */
  it("records what a stopped routed call's paid legs spent, then rethrows the stop", async () => {
    const { service, router, recorded, seed } = harness();
    await seed();
    const stop = new InstantEvalJudgeStoppedError({
      inputTokens: 1000,
      costNanoUsd: 5000,
      cause: new DOMException("stopped", "AbortError"),
    });
    vi.spyOn(router, "classify").mockRejectedValue(stop);

    const judging = service.judge({ ...call, route: { job: "llm_judge", tokens: 100 } });

    await expect(judging).rejects.toBe(stop);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      model: "langwatch-judge",
      inputTokens: 1000,
      costNanoUsd: 5000,
      priceNanoUsd: 5000 * INSTANT_EVAL_PRICING.markup,
    });
  });

  /** @scenario "A caller's stop keeps the legs already paid billed" */
  it("records a stop under its own request id, so the redelivery with the same key bills too", async () => {
    const { service, router, recorded, repositories, seed } = harness();
    await seed();
    const requestKey = "project-1:evaluation-1:execution";
    const stop = new InstantEvalJudgeStoppedError({
      inputTokens: 1000,
      costNanoUsd: 5000,
      cause: new DOMException("stopped", "AbortError"),
    });
    vi.spyOn(router, "classify").mockRejectedValueOnce(stop);
    const routed = { ...call, requestKey, route: { job: "llm_judge" as const, tokens: 100 } };

    await expect(service.judge(routed)).rejects.toBe(stop);
    await service.judge(routed);

    expect(recorded.map((fact) => fact.requestId)).toEqual([
      "minted-1",
      `instantevaljudge_${requestKey}`,
    ]);
    // Both rows are kept: the stopped legs and the full redelivered call were both paid.
    const { spendNanoUsd } = await repositories.spend.getTotal({ organizationId: ORGANIZATION_ID });
    expect(spendNanoUsd).toBe(
      BigInt(5000 * INSTANT_EVAL_PRICING.markup + 1_000_000_000 * INSTANT_EVAL_PRICING.markup),
    );
  });

  /** @scenario "A routed judgement with a cost of zero is still routed" */
  it("prices a routed call that cost nothing at zero, under the router's model and rate", async () => {
    const { service, recorded, seed } = harness({ routeUsdPerMillion: 0 });
    await seed();

    const answer = await service.judge({ ...call, route: { job: "llm_judge", tokens: 100 } });

    expect(answer).toMatchObject({ outcome: "judged", priceUsd: 0 });
    expect(recorded[0]).toMatchObject({
      model: "langwatch-judge",
      rateVersion: `instant_eval_judge_router@testx${INSTANT_EVAL_PRICING.markup}`,
      costNanoUsd: 0,
      priceNanoUsd: 0,
      inputTokens: 1_000_000,
    });
  });

  /** @scenario "Routed and unrouted tokens are billed separately" */
  it("bills a mixed run's unrouted tokens at the published rate on top of its routed cost", async () => {
    const { service, recorded } = harness();

    await service.recordSpend({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      requestId: "run-1",
      inputTokens: 1_500_000,
      costNanoUsd: 100_000_000,
      routedInputTokens: 500_000,
      requests: 2,
      occurredAt: NOW,
    });

    // $0.10 routed, plus one million unrouted tokens at the published $0.042 per million.
    expect(recorded[0]).toMatchObject({ costNanoUsd: 142_000_000, model: "langwatch-judge" });
  });

  /** @scenario "Routed and unrouted tokens are billed separately" */
  it("bills a routed cost that covers no input tokens, under the router's model", async () => {
    const { service, recorded } = harness();

    await service.recordSpend({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      requestId: "run-1",
      inputTokens: 1_000_000,
      costNanoUsd: 5_000_000,
      routedInputTokens: 0,
      requests: 2,
      occurredAt: NOW,
    });

    // $0.005 of output-only routed cost, plus one million unrouted tokens at $0.042.
    expect(recorded[0]).toMatchObject({ costNanoUsd: 47_000_000, model: "langwatch-judge" });
  });
});

describe("given the unmetered classify the Api and the judge call share", () => {
  describe("when the call carries a route", () => {
    it("asks the router, not the classifier, and records no spend", async () => {
      const { service, classifier, recorded } = harness();

      const judgement = await service.classifyOnce({
        ...call,
        route: { job: "llm_judge", tokens: 100 },
      });

      expect(classifier.classify).not.toHaveBeenCalled();
      expect(judgement.costNanoUsd).toBe(1_000_000_000);
      expect(recorded).toEqual([]);
    });
  });

  describe("when no classifier is configured", () => {
    it("is a skip, never a refusal", async () => {
      const { service } = harness({ hasClassifier: false });

      const judgement = await service.classifyOnce(call);

      expect(judgement.skippedReason).toBe("classifier_not_configured");
    });
  });
});
