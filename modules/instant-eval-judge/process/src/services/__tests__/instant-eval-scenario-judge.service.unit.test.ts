/**
 * A scenario judgement over scripted channels: one routed question per criterion, one shared send
 * of the judge's own verdict call, the unrouted turn decision, and one priced fact. No network.
 * @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 */
import {
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING,
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
  INSTANT_EVAL_PRICING,
  type InstantEvalJudgement,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeRouteTable,
  type InstantEvalJudgeSpendPricedEventData,
  instantEvalJudgeSpendPricedEventDataSchema,
  instantEvalSkipped,
} from "@langwatch/instant-eval-judge-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryInstantEvalClassifierChannel } from "../../__tests__/support/instant-eval-classifier.test-fakes.ts";
import {
  ScriptedInstantEvalHostedDecisionsChannel,
  ScriptedInstantEvalLlmJudgeChannel,
} from "../../__tests__/support/instant-eval-judge-router.test-fakes.ts";
import { MemoryInstantEvalRateLimiter } from "../../__tests__/support/instant-eval-rate-limiter.test-fakes.ts";
import {
  finishTestInput,
  scenarioJudgeCall,
  SYNTHETIC_SCENARIO_PRICING,
  syntheticGatedScenarioRouteTable,
  syntheticScenarioRouteTable,
} from "../../__tests__/support/instant-eval-scenario-judge.test-fakes.ts";
import type {
  InstantEvalLlmToolCallAnswer,
  InstantEvalLlmToolCallRequest,
} from "../../channels/instant-eval-llm-judge.channel.ts";
import { MemoryInstantEvalDecisionModelChannel } from "../../channels/memory/memory.instant-eval-decision-model.channel.ts";
import {
  MemoryInstantEvalJudgeProjectRepository,
  MemoryInstantEvalJudgeRepositories,
} from "../../repositories/memory/memory.instant-eval-judge.repositories.ts";
import { InstantEvalJudgeRouterService } from "../instant-eval-judge-router.service.ts";
import { InstantEvalJudgeService } from "../instant-eval-judge.service.ts";
import { InstantEvalScenarioJudgeService } from "../instant-eval-scenario-judge.service.ts";

const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";
const NOW = 1_760_000_000_000;
const DECISION_TOKENS = 1_000;

/** P(yes) per criterion key; a key left out is a criterion the decision model did not answer. */
type Probabilities = Readonly<Record<string, number>>;

const SURE: Probabilities = { criterion_0: 0.995, criterion_1: 0.002, criterion_2: 0.99 };

function decisionAnswer(
  probabilities: Probabilities,
  questionId: string | undefined,
): InstantEvalJudgement {
  const probability = questionId === undefined ? undefined : probabilities[questionId];
  if (questionId === undefined || probability === undefined) {
    return { ...instantEvalSkipped("classifier_provider_unavailable"), inputTokens: 0 };
  }
  return {
    verdicts: [{ questionId, probability }],
    inputTokens: DECISION_TOKENS,
    isTextTruncated: false,
  };
}

const STATUS_OF = { true: "passed", false: "failed", inconclusive: "inconclusive" } as const;

/** An LLM's finish_test call in the scenario SDK's shape, each status written as "true" etc. */
const finishTest = (
  criteria: Readonly<Record<string, keyof typeof STATUS_OF>>,
  reasoning = "the transcript settles it",
): InstantEvalLlmToolCallAnswer => ({
  outcome: "answered",
  tool: "finish_test",
  input: finishTestInput(
    Object.fromEntries(Object.entries(criteria).map(([key, said]) => [key, STATUS_OF[said]])),
    reasoning,
  ),
  inputTokens: 2_000,
  outputTokens: 100,
});

const LLM_DOWN: InstantEvalLlmToolCallAnswer = {
  outcome: "skipped",
  reason: "classifier_provider_unavailable",
  inputTokens: 0,
  outputTokens: 0,
};

const GATE_TOKENS = 400;

function harness({
  probabilities = SURE,
  gateScores = {},
  toolCall = () => finishTest({}),
  table = syntheticScenarioRouteTable(),
  pricing = SYNTHETIC_SCENARIO_PRICING,
  isCloud = true,
  isProjectKnown = true,
  spentNanoUsd = 0n,
  beforeDecision,
}: {
  probabilities?: Probabilities;
  /** Awaited inside each hosted decision request before it answers. */
  beforeDecision?: () => Promise<void>;
  /** The gate's difficulty score per criterion key; a key left out is a case it did not rate. */
  gateScores?: Readonly<Record<string, number>>;
  toolCall?: (
    request: InstantEvalLlmToolCallRequest,
    signal?: AbortSignal,
  ) => InstantEvalLlmToolCallAnswer | Promise<InstantEvalLlmToolCallAnswer>;
  table?: InstantEvalJudgeRouteTable;
  pricing?: InstantEvalJudgeRoutePricing;
  isCloud?: boolean;
  isProjectKnown?: boolean;
  spentNanoUsd?: bigint;
} = {}) {
  const repositories = {
    ...MemoryInstantEvalJudgeRepositories.create(),
    projects: MemoryInstantEvalJudgeProjectRepository.create({
      rows: new Map(isProjectKnown ? [[PROJECT_ID, { organizationId: ORGANIZATION_ID }]] : []),
    }),
  };
  const hostedDecisions = ScriptedInstantEvalHostedDecisionsChannel.create({
    answer: async ({ questions }) => {
      await beforeDecision?.();
      return decisionAnswer(probabilities, questions[0]?.id);
    },
  });
  const classifierRequests: string[] = [];
  const gateRequests: string[] = [];
  /** The text each gate send read, per criterion key. */
  const gateTexts = new Map<string, string>();
  const classifier = MemoryInstantEvalClassifierChannel.create({
    answer: async ({ questions, text }) => {
      const asked = questions[0];
      if (asked?.kind === "score") {
        gateRequests.push(asked.id);
        gateTexts.set(asked.id, text);
        const score = gateScores[asked.id];
        return {
          verdicts: score === undefined ? [] : [{ questionId: asked.id, score }],
          inputTokens: GATE_TOKENS,
          isTextTruncated: false,
        };
      }
      classifierRequests.push(asked?.id ?? "");
      return decisionAnswer(probabilities, asked?.id);
    },
  });
  const llmJudge = ScriptedInstantEvalLlmJudgeChannel.create({
    answer: () => {
      throw new Error("a scenario criterion never asks the evaluation tool");
    },
    toolCall,
  });
  const limiter = MemoryInstantEvalRateLimiter.create();
  const { logger, lines } = createTestLogger();
  const router = InstantEvalJudgeRouterService.create({
    table,
    pricing,
    classifier,
    hostedDecisions,
    llmJudge,
    limiter,
    logger,
  });
  const recorded: InstantEvalJudgeSpendPricedEventData[] = [];
  let minted = 0;
  const judge = InstantEvalJudgeService.create({
    decisionModels: MemoryInstantEvalDecisionModelChannel.create(),
    repositories,
    classifier,
    router,
    routePricing: pricing,
    limiter,
    isCloud,
    recordSpendPriced: async (fact) => {
      recorded.push(instantEvalJudgeSpendPricedEventDataSchema.parse(fact));
    },
    mintRequestId: () => `minted-${++minted}`,
    now: () => Temporal.Instant.fromEpochMilliseconds(NOW),
    logger,
  });
  const service = InstantEvalScenarioJudgeService.create({
    judge,
    router,
    table,
    pricing,
    llmJudge,
    limiter,
    logger,
  });
  const seed = async () => {
    if (spentNanoUsd === 0n) return;
    await repositories.spend.create({
      organizationId: ORGANIZATION_ID,
      requestId: "earlier",
      spendNanoUsd: spentNanoUsd,
      occurredAtMs: 1,
    });
  };
  return {
    service,
    hostedDecisions,
    classifierRequests,
    gateRequests,
    gateTexts,
    llmJudge,
    recorded,
    lines,
    seed,
  };
}

describe("given a scenario verdict call on LangWatch Cloud", () => {
  describe("when it carries three criteria", () => {
    /** @scenario "Each criterion is routed as its own yes or no question" */
    it("sends the decision model one request per criterion, each with one question", async () => {
      const { service, hostedDecisions } = harness();

      await service.judge(scenarioJudgeCall());

      expect(hostedDecisions.requests.map((request) => request.questions.length)).toEqual([
        1, 1, 1,
      ]);
      expect(
        hostedDecisions.requests
          .map((request) => request.questions[0]?.id ?? "")
          .toSorted((a, b) => a.localeCompare(b)),
      ).toEqual(["criterion_0", "criterion_1", "criterion_2"]);
      expect(hostedDecisions.requests[0]?.text).toBe(
        "# Scenario\nA customer asks for a refund on a late order\n\n<transcript>user: my order is late\nassistant: I refunded it</transcript>",
      );
    });
  });

  describe("when every decision answer is sure", () => {
    /** @scenario "A sure decision answer settles its criterion without an LLM call" */
    it("reads met at one half or more and unmet below, with no LLM call", async () => {
      const { service, llmJudge } = harness();

      const answer = await service.judge(scenarioJudgeCall());

      expect(answer).toMatchObject({
        outcome: "judged",
        phase: "verdict",
        criteria: [
          { key: "criterion_0", result: "met" },
          { key: "criterion_1", result: "unmet" },
          { key: "criterion_2", result: "met" },
        ],
      });
      expect(answer).not.toHaveProperty("reasoning");
      expect(llmJudge.calls).toHaveLength(0);
    });
  });

  describe("when two of the three criteria get an unsure decision answer", () => {
    const probabilities = { criterion_0: 0.6, criterion_1: 0.002, criterion_2: 0.4 };

    /** @scenario "Unsure criteria share one send of the judge's own verdict call" */
    it("sends the judge's own call once and reads both criteria from it by key", async () => {
      const { service, llmJudge, recorded } = harness({
        probabilities,
        toolCall: () =>
          finishTest({ criterion_0: "false", criterion_1: "true", criterion_2: "true" }),
      });
      const call = scenarioJudgeCall();

      const answer = await service.judge(call);

      expect(llmJudge.calls).toHaveLength(1);
      expect(llmJudge.calls[0]).toMatchObject({
        wire: "openai_responses",
        model: "llm-model-a",
        system: call.llmCall.system,
        user: call.llmCall.user,
        forcedTool: "finish_test",
      });
      expect(llmJudge.calls[0]?.tools.map((tool) => tool.name)).toEqual(["finish_test"]);
      // criterion_1 was sure, so the decision model's answer stands whatever the LLM said of it.
      expect(answer).toMatchObject({
        criteria: [
          { key: "criterion_0", result: "unmet" },
          { key: "criterion_1", result: "unmet" },
          { key: "criterion_2", result: "met" },
        ],
      });
      // Three decision requests at 1 USD per million, one LLM call at 10 in and 100 out.
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.costNanoUsd).toBe(3 * 1_000 * 1_000 + 2_000 * 10_000 + 100 * 100_000);
      expect(recorded[0]?.inputTokens).toBe(3 * DECISION_TOKENS + 2_000);
    });
  });

  describe("when the shared call's reasoning sits beside criteria it did not settle", () => {
    /** @scenario "The verdict carries the shared call's reasoning only when that call settled every criterion" */
    it("leaves the reasoning out, so it cannot contradict a criterion settled elsewhere", async () => {
      const { service } = harness({
        probabilities: { criterion_0: 0.6, criterion_1: 0.002, criterion_2: 0.4 },
        // The LLM says criterion_1 was met; the sure decision answer says it was not.
        toolCall: () =>
          finishTest({ criterion_0: "false", criterion_1: "true", criterion_2: "true" }),
      });

      const answer = await service.judge(scenarioJudgeCall());

      expect(answer).toMatchObject({
        criteria: expect.arrayContaining([{ key: "criterion_1", result: "unmet" }]),
      });
      expect(answer).not.toHaveProperty("reasoning");
    });

    /** @scenario "The verdict carries the shared call's reasoning only when that call settled every criterion" */
    it("carries the reasoning when the shared call settled every criterion", async () => {
      const { service } = harness({
        probabilities: { criterion_0: 0.6, criterion_1: 0.5, criterion_2: 0.4 },
        toolCall: () =>
          finishTest({ criterion_0: "false", criterion_1: "true", criterion_2: "true" }),
      });

      const answer = await service.judge(scenarioJudgeCall());

      expect(answer).toMatchObject({
        criteria: [
          { key: "criterion_0", result: "unmet" },
          { key: "criterion_1", result: "met" },
          { key: "criterion_2", result: "met" },
        ],
        reasoning: "the transcript settles it",
      });
    });
  });

  describe("when nine unsure criteria cross the parallel batch boundary", () => {
    const keys = Array.from({ length: 9 }, (_, at) => `criterion_${at}`);
    const probabilities = Object.fromEntries(keys.map((key) => [key, 0.5]));
    const call = scenarioJudgeCall({
      criteria: keys.map((key) => ({ key, text: `The agent does thing ${key}` })),
    });

    /** @scenario "Criteria past the parallel cap share the same send and keep their order" */
    it("sends the judge's own call once across both batches and keeps the key order", async () => {
      const { service, llmJudge, recorded } = harness({
        probabilities,
        toolCall: () =>
          finishTest(
            Object.fromEntries(keys.map((key, at) => [key, at % 2 === 0 ? "true" : "false"])),
          ),
      });

      const answer = await service.judge(call);

      expect(llmJudge.calls).toHaveLength(1);
      expect(answer).toMatchObject({
        outcome: "judged",
        criteria: keys.map((key, at) => ({ key, result: at % 2 === 0 ? "met" : "unmet" })),
      });
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.requests).toBe(9);
    });

    it("keeps at most eight decision requests in flight at once", async () => {
      let inFlight = 0;
      let most = 0;
      const { service, hostedDecisions } = harness({
        probabilities,
        toolCall: () => finishTest(Object.fromEntries(keys.map((key) => [key, "true"]))),
        beforeDecision: async () => {
          inFlight += 1;
          most = Math.max(most, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
        },
      });

      await service.judge(call);

      expect(hostedDecisions.requests).toHaveLength(9);
      expect(most).toBe(8);
    });
  });

  describe("when the judge's verdict call marks an unsure criterion inconclusive", () => {
    /** @scenario "An LLM's inconclusive answer stays inconclusive" */
    it("reports that criterion inconclusive", async () => {
      const { service } = harness({
        probabilities: { ...SURE, criterion_0: 0.5 },
        toolCall: () => finishTest({ criterion_0: "inconclusive" }),
      });

      const answer = await service.judge(scenarioJudgeCall());

      expect(answer).toMatchObject({
        criteria: [
          { key: "criterion_0", result: "inconclusive" },
          { key: "criterion_1", result: "unmet" },
          { key: "criterion_2", result: "met" },
        ],
      });
    });
  });

  describe("when every leg fails for one criterion", () => {
    /** @scenario "A criterion no leg answered is inconclusive, never a guess" */
    it("reports it inconclusive and keeps the others", async () => {
      const { service } = harness({
        probabilities: { criterion_1: 0.001, criterion_2: 0.999 },
        toolCall: () => LLM_DOWN,
      });

      const answer = await service.judge(scenarioJudgeCall());

      expect(answer).toMatchObject({
        outcome: "judged",
        criteria: [
          { key: "criterion_0", result: "inconclusive" },
          { key: "criterion_1", result: "unmet" },
          { key: "criterion_2", result: "met" },
        ],
      });
    });
  });

  describe("when every leg fails for every criterion", () => {
    /** @scenario "A verdict nothing answered is unavailable" */
    it("answers unavailable, with no criteria and no spend", async () => {
      const { service, recorded } = harness({ probabilities: {}, toolCall: () => LLM_DOWN });

      const answer = await service.judge(scenarioJudgeCall());

      expect(answer).toEqual({ outcome: "unavailable" });
      expect(recorded).toHaveLength(0);
    });
  });

  describe("when the decision model is down", () => {
    /** @scenario "A failed primary sends its criterion to the escalation" */
    it("reads every criterion from the one shared verdict call", async () => {
      const { service, llmJudge } = harness({
        probabilities: {},
        toolCall: () =>
          finishTest({ criterion_0: "true", criterion_1: "false", criterion_2: "true" }),
      });

      const answer = await service.judge(scenarioJudgeCall());

      expect(llmJudge.calls).toHaveLength(1);
      expect(answer).toMatchObject({
        criteria: [
          { key: "criterion_0", result: "met" },
          { key: "criterion_1", result: "unmet" },
          { key: "criterion_2", result: "met" },
        ],
      });
    });
  });

  describe("when a criterion is answered right at the route's threshold", () => {
    /** @scenario "The threshold is compared on the router's sureness scale" */
    it("keeps 0.99 and 0.01 and escalates 0.989 at a threshold of 0.98", async () => {
      const { service, llmJudge } = harness({
        probabilities: { criterion_0: 0.99, criterion_1: 0.01, criterion_2: 0.989 },
        toolCall: () =>
          finishTest({ criterion_0: "false", criterion_1: "true", criterion_2: "false" }),
      });

      const answer = await service.judge(scenarioJudgeCall());

      expect(llmJudge.calls).toHaveLength(1);
      expect(answer).toMatchObject({
        criteria: [
          { key: "criterion_0", result: "met" },
          { key: "criterion_1", result: "unmet" },
          { key: "criterion_2", result: "unmet" },
        ],
      });
    });
  });

  describe("when the judged text falls in the long bucket", () => {
    /** @scenario "The length bucket picks the criterion's route" */
    it("asks the long slot's decision model and escalates at its threshold", async () => {
      const { service, hostedDecisions, classifierRequests, llmJudge } = harness({
        probabilities: { criterion_0: 0.9, criterion_1: 0.1, criterion_2: 0.89 },
        toolCall: () => finishTest({ criterion_2: "true" }),
      });
      // 8,000 tokens at the estimate's 2.7 bytes per token, less the scenario heading.
      const content = "x".repeat(21_600);

      const answer = await service.judge(scenarioJudgeCall({ content }));

      expect(hostedDecisions.requests).toHaveLength(0);
      expect(classifierRequests.toSorted()).toEqual(["criterion_0", "criterion_1", "criterion_2"]);
      expect(llmJudge.calls.map((call) => call.model)).toEqual(["llm-model-b"]);
      expect(answer).toMatchObject({
        criteria: [
          { key: "criterion_0", result: "met" },
          { key: "criterion_1", result: "unmet" },
          { key: "criterion_2", result: "met" },
        ],
      });
    });
  });

  describe("when the judgement is recorded", () => {
    /** @scenario "A judgement is one priced fact under the judge preview model" */
    it("appends one fact with the summed cost, the marked-up price and the criteria count", async () => {
      const { service, recorded } = harness();

      const answer = await service.judge(scenarioJudgeCall({ requestKey: "run-1:verdict" }));

      const costNanoUsd = 3 * DECISION_TOKENS * 1_000;
      expect(recorded).toEqual([
        expect.objectContaining({
          model: "langwatch-judge-preview",
          requestId: "instantevaljudge_run-1:verdict",
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          costNanoUsd,
          priceNanoUsd: Math.round(costNanoUsd * INSTANT_EVAL_PRICING.markup),
          inputTokens: 3 * DECISION_TOKENS,
          requests: 3,
        }),
      ]);
      expect(answer).toMatchObject({
        inputTokens: 3 * DECISION_TOKENS,
        priceUsd: (costNanoUsd * INSTANT_EVAL_PRICING.markup) / 1e9,
      });
    });
  });

  describe("when the caller stops after the decision requests were paid", () => {
    /** @scenario "A caller's stop after paid legs still records what they spent" */
    it("records the paid legs under a minted request id and rethrows the stop", async () => {
      const stop = new AbortController();
      const { service, recorded } = harness({
        probabilities: { criterion_0: 0.5, criterion_1: 0.5, criterion_2: 0.5 },
        toolCall: (_request, signal) =>
          new Promise((_, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
            stop.abort(new DOMException("stopped", "AbortError"));
          }),
      });

      await expect(
        service.judge(scenarioJudgeCall({ signal: stop.signal, requestKey: "run-1:verdict" })),
      ).rejects.toMatchObject({ name: "AbortError" });

      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        model: "langwatch-judge-preview",
        requestId: "minted-1",
        costNanoUsd: 3 * DECISION_TOKENS * 1_000,
      });
    });
  });
});

describe("given a scenario turn decision call", () => {
  describe("when the table names a decision backend", () => {
    /** @scenario "The turn decision is the judge's own call on the table's decision backend" */
    it("sends the judge's messages with both decision tools and answers the tool called", async () => {
      const { service, llmJudge, hostedDecisions, recorded } = harness({
        toolCall: () => ({
          outcome: "answered",
          tool: "make_verdict",
          input: {},
          inputTokens: 500,
          outputTokens: 10,
        }),
      });
      const call = scenarioJudgeCall({ phase: "decision" });

      const answer = await service.judge(call);

      expect(answer).toMatchObject({ outcome: "judged", phase: "decision", decision: "verdict" });
      expect(hostedDecisions.requests).toHaveLength(0);
      expect(llmJudge.calls).toHaveLength(1);
      expect(llmJudge.calls[0]).toMatchObject({
        model: "llm-model-a",
        system: call.llmCall.system,
      });
      expect(llmJudge.calls[0]).not.toHaveProperty("forcedTool");
      expect(llmJudge.calls[0]?.tools.map((tool) => tool.name)).toEqual([
        "continue_test",
        "make_verdict",
      ]);
      expect(recorded).toEqual([
        expect.objectContaining({
          model: "langwatch-judge-preview",
          costNanoUsd: 500 * 10_000 + 10 * 100_000,
          requests: 1,
        }),
      ]);
    });

    it("answers continue when the judge calls continue_test", async () => {
      const { service } = harness({
        toolCall: () => ({
          outcome: "answered",
          tool: "continue_test",
          input: {},
          inputTokens: 500,
          outputTokens: 10,
        }),
      });

      const answer = await service.judge(scenarioJudgeCall({ phase: "decision" }));

      expect(answer).toMatchObject({ outcome: "judged", decision: "continue" });
    });
  });

  describe("when the decision backend fails", () => {
    /** @scenario "A turn decision that fails lets the conversation go on" */
    it("answers continue at no price", async () => {
      const { service, recorded } = harness({ toolCall: () => LLM_DOWN });

      const answer = await service.judge(scenarioJudgeCall({ phase: "decision" }));

      expect(answer).toEqual({
        outcome: "judged",
        phase: "decision",
        decision: "continue",
        inputTokens: 0,
        priceUsd: 0,
      });
      expect(recorded).toHaveLength(0);
    });

    it("answers continue when the call throws, and bills an unreadable answer's tokens", async () => {
      const thrown = harness({
        toolCall: () => {
          throw new Error("socket closed");
        },
      });
      const unreadable = harness({
        toolCall: () => ({
          outcome: "skipped",
          reason: "classifier_failed",
          inputTokens: 500,
          outputTokens: 0,
        }),
      });

      const afterThrow = await thrown.service.judge(scenarioJudgeCall({ phase: "decision" }));
      const afterUnreadable = await unreadable.service.judge(
        scenarioJudgeCall({ phase: "decision" }),
      );

      expect(afterThrow).toMatchObject({ decision: "continue", priceUsd: 0 });
      expect(afterUnreadable).toMatchObject({ decision: "continue", inputTokens: 500 });
      expect(unreadable.recorded[0]).toMatchObject({ costNanoUsd: 500 * 10_000 });
    });
  });

  describe("when the decision backend fails and it lists fallbacks", () => {
    // llm-off is switched off and decision-a is not an LLM, so only llm-c may take the call.
    const table = syntheticScenarioRouteTable({
      backends: {
        "llm-a": {
          kind: "openai_responses",
          model: "llm-model-a",
          timeoutMs: 5000,
          fallbacks: ["llm-off", "decision-a", "llm-c"],
        },
        "llm-off": {
          kind: "anthropic_messages",
          model: "llm-model-off",
          timeoutMs: 5000,
          enabled: false,
        },
        "llm-c": { kind: "gemini_generate_content", model: "llm-model-c", timeoutMs: 5000 },
      },
    });

    /** @scenario "A failed decision backend hands the turn decision to its enabled fallback" */
    it("asks the enabled LLM fallback next, answers its tool and bills both calls", async () => {
      const { service, llmJudge, hostedDecisions, recorded } = harness({
        table,
        toolCall: (request) =>
          request.wire === "openai_responses"
            ? { outcome: "skipped", reason: "classifier_failed", inputTokens: 500, outputTokens: 0 }
            : {
                outcome: "answered",
                tool: "make_verdict",
                input: {},
                inputTokens: 400,
                outputTokens: 10,
              },
      });

      const answer = await service.judge(scenarioJudgeCall({ phase: "decision" }));

      expect(answer).toMatchObject({ outcome: "judged", phase: "decision", decision: "verdict" });
      expect(llmJudge.calls.map(({ wire, model }) => ({ wire, model }))).toEqual([
        { wire: "openai_responses", model: "llm-model-a" },
        { wire: "gemini_generate_content", model: "llm-model-c" },
      ]);
      expect(hostedDecisions.requests).toHaveLength(0);
      expect(recorded).toEqual([
        expect.objectContaining({
          costNanoUsd: 500 * 10_000 + 400 * 30_000 + 10 * 300_000,
          inputTokens: 900,
          requests: 1,
        }),
      ]);
    });
  });

  describe("when the table names no decision backend", () => {
    /** @scenario "A table that names no decision backend answers no turn decision" */
    it("answers unavailable and sends nothing", async () => {
      const { service, llmJudge } = harness({
        table: INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
        pricing: INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING,
      });

      const answer = await service.judge(scenarioJudgeCall({ phase: "decision" }));

      expect(answer).toEqual({ outcome: "unavailable" });
      expect(llmJudge.calls).toHaveLength(0);
    });
  });
});

describe("given an LLM backend that sets its own output cap", () => {
  const table = syntheticScenarioRouteTable({
    backends: {
      "llm-a": {
        kind: "openai_responses",
        model: "llm-model-a",
        reasoningEffort: "high",
        maxOutputTokens: 1_100,
      },
    },
  });

  describe("when an unsure criterion escalates to it", () => {
    /** @scenario "The judge's own calls carry the backend's output cap" */
    it("sends the judge's own verdict call with that cap", async () => {
      const { service, llmJudge } = harness({
        table,
        probabilities: { ...SURE, criterion_0: 0.6 },
        toolCall: () => finishTest({ criterion_0: "true" }),
      });

      await service.judge(scenarioJudgeCall());

      expect(llmJudge.calls).toHaveLength(1);
      expect(llmJudge.calls[0]).toMatchObject({
        forcedTool: "finish_test",
        reasoningEffort: "high",
        maxOutputTokens: 1_100,
      });
    });
  });

  describe("when it is the turn decision backend", () => {
    /** @scenario "The judge's own calls carry the backend's output cap" */
    it("sends the judge's turn decision call with that cap", async () => {
      const { service, llmJudge } = harness({
        table,
        toolCall: () => ({
          outcome: "answered",
          tool: "continue_test",
          input: {},
          inputTokens: 500,
          outputTokens: 10,
        }),
      });

      await service.judge(scenarioJudgeCall({ phase: "decision" }));

      expect(llmJudge.calls).toHaveLength(1);
      expect(llmJudge.calls[0]).toMatchObject({ reasoningEffort: "high", maxOutputTokens: 1_100 });
    });
  });
});

describe("given a scenario judge call that may not be answered", () => {
  describe("when the installation is not LangWatch Cloud", () => {
    /** @scenario "A scenario judgement off LangWatch Cloud is refused and sends nothing" */
    it("refuses it as not configured and calls no backend", async () => {
      const { service, hostedDecisions, llmJudge } = harness({ isCloud: false });

      const verdict = await service.judge(scenarioJudgeCall());
      const decision = await service.judge(scenarioJudgeCall({ phase: "decision" }));

      expect(verdict).toMatchObject({ outcome: "refused", code: "classifier_not_configured" });
      expect(decision).toMatchObject({ outcome: "refused", code: "classifier_not_configured" });
      expect(hostedDecisions.requests).toHaveLength(0);
      expect(llmJudge.calls).toHaveLength(0);
    });
  });

  describe("when the judge has not learned the project", () => {
    /** @scenario "A project the judge has not learned is refused" */
    it("refuses it as unknown and calls no backend", async () => {
      const { service, hostedDecisions } = harness({ isProjectKnown: false });

      const answer = await service.judge(scenarioJudgeCall());

      expect(answer).toMatchObject({ outcome: "refused", code: "instant_eval_project_unknown" });
      expect(hostedDecisions.requests).toHaveLength(0);
    });
  });

  describe("when the organization has spent its free budget", () => {
    /** @scenario "A spent free budget refuses the scenario judgement" */
    it("refuses it as budget exhausted and calls no backend", async () => {
      const { service, hostedDecisions, seed } = harness({ spentNanoUsd: 1_000_000_000n });
      await seed();

      const answer = await service.judge(scenarioJudgeCall());

      expect(answer).toMatchObject({
        outcome: "refused",
        code: "instant_eval_free_budget_exhausted",
      });
      expect(hostedDecisions.requests).toHaveLength(0);
    });
  });
});

describe("given a gated scenario route", () => {
  const table = syntheticGatedScenarioRouteTable();
  const gateScores = { criterion_0: 0.2, criterion_1: 0.75, criterion_2: 2 };

  describe("when the gate rates one criterion easy and two hard", () => {
    /** @scenario "A gated route sends an easy criterion to the primary and a hard one to the shared call" */
    it("asks the decision model the easy one alone and the LLM the hard ones in one send", async () => {
      const { service, hostedDecisions, gateRequests, llmJudge, recorded } = harness({
        table,
        gateScores,
        // Unsure on purpose: after a gate no sureness is read, so the easy answer stands.
        probabilities: { criterion_0: 0.6 },
        toolCall: () => finishTest({ criterion_1: "false", criterion_2: "true" }),
      });

      const answer = await service.judge(scenarioJudgeCall());

      expect(gateRequests.toSorted()).toEqual(["criterion_0", "criterion_1", "criterion_2"]);
      expect(hostedDecisions.requests.map((request) => request.questions[0]?.id)).toEqual([
        "criterion_0",
      ]);
      expect(llmJudge.calls).toHaveLength(1);
      expect(answer).toMatchObject({
        outcome: "judged",
        criteria: [
          { key: "criterion_0", result: "met" },
          { key: "criterion_1", result: "unmet" },
          { key: "criterion_2", result: "met" },
        ],
      });
      // The decision model settled the easy criterion, so the shared call's reasoning is left out.
      expect(answer).not.toHaveProperty("reasoning");
      // Three gate sends at 5, one decision request at 1, one LLM call at 10 in and 100 out.
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.costNanoUsd).toBe(
        3 * GATE_TOKENS * 5_000 + 1_000 * 1_000 + 2_000 * 10_000 + 100 * 100_000,
      );
      expect(recorded[0]?.model).toBe("langwatch-judge-preview");
    });

    /** @scenario "The gate reads a criterion as the raw criterion the benchmark measured" */
    it("tells the gate each raw criterion as its task, without the decision question's framing", async () => {
      const { service, gateTexts } = harness({ table, gateScores });

      await service.judge(scenarioJudgeCall());

      expect(gateTexts.get("criterion_0")).toContain("Task: The agent offers a refund\n");
      expect(gateTexts.get("criterion_2")).toContain(
        "Task: The agent does not ask for a card number\n",
      );
      expect(gateTexts.get("criterion_0")).not.toContain("Judge the AI agent under test");
    });

    /** @scenario "The shared verdict call carries the backend's reasoning effort" */
    it("names the escalation backend's effort on the judge's own verdict call", async () => {
      const { service, llmJudge } = harness({ table, gateScores });

      await service.judge(scenarioJudgeCall());

      expect(llmJudge.calls[0]).toMatchObject({
        wire: "openai_responses",
        model: "llm-model-a",
        reasoningEffort: "medium",
      });
    });
  });

  describe("when a long conversation's criterion gets an unsure classifier answer", () => {
    const content = "x".repeat(40_000);

    /** @scenario "A Gemini backend answers the judge's own call as a forced function call" */
    it("escalates to the Gemini backend on the router's sureness scale, with no effort", async () => {
      const { service, llmJudge, classifierRequests, recorded } = harness({
        table,
        // abs(2p - 1) against 0.9: 0.96 is 0.92 and kept, 0.94 is 0.88 and escalates, 0.04 is
        // 0.92 and kept. The LLM contradicts the kept ones, so a wrong escalation would show.
        probabilities: { criterion_0: 0.96, criterion_1: 0.94, criterion_2: 0.04 },
        toolCall: () =>
          finishTest({ criterion_0: "false", criterion_1: "true", criterion_2: "true" }),
      });

      const answer = await service.judge(scenarioJudgeCall({ content }));

      expect(classifierRequests.toSorted()).toEqual(["criterion_0", "criterion_1", "criterion_2"]);
      expect(llmJudge.calls).toHaveLength(1);
      expect(llmJudge.calls[0]).toMatchObject({
        wire: "gemini_generate_content",
        model: "llm-model-c",
        forcedTool: "finish_test",
      });
      expect(llmJudge.calls[0]).not.toHaveProperty("reasoningEffort");
      expect(answer).toMatchObject({
        criteria: [
          { key: "criterion_0", result: "met" },
          { key: "criterion_1", result: "met" },
          { key: "criterion_2", result: "unmet" },
        ],
      });
      expect(recorded[0]?.costNanoUsd).toBe(3 * 1_000 * 2_000 + 2_000 * 30_000 + 100 * 300_000);
    });
  });

  describe("when the turn decision's backend is a Gemini backend", () => {
    /** @scenario "The turn decision is the judge's own call on the table's decision backend" */
    it("sends the judge's own decision call on that wire", async () => {
      const { service, llmJudge } = harness({
        table,
        toolCall: () => ({
          outcome: "answered",
          tool: "make_verdict",
          input: {},
          inputTokens: 500,
          outputTokens: 10,
        }),
      });

      const answer = await service.judge(scenarioJudgeCall({ phase: "decision" }));

      expect(llmJudge.calls[0]).toMatchObject({ wire: "gemini_generate_content" });
      expect(answer).toMatchObject({ outcome: "judged", phase: "decision", decision: "verdict" });
    });
  });
});
