/**
 * The router over scripted channels: escalation on unsure, the confident pair, fallbacks, the
 * kept primary when the LLM leg fails, and the skip when nothing answers. No network.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  InstantEvalClassifierUnavailableError,
  InstantEvalJudgeStoppedError,
  instantEvalSkipped,
  type InstantEvalJudgement,
  type InstantEvalJudgeRoute,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeRouteTable,
  type InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import { MemoryInstantEvalClassifierChannel } from "../../__tests__/support/instant-eval-classifier.test-fakes.ts";
import {
  choiceOf,
  rating,
  SYNTHETIC_KINDS,
  syntheticRouteTable,
  yesNo,
} from "../../__tests__/support/instant-eval-judge-route.test-fakes.ts";
import {
  hangUntilAborted,
  ScriptedInstantEvalHostedDecisionsChannel,
  ScriptedInstantEvalLlmJudgeChannel,
} from "../../__tests__/support/instant-eval-judge-router.test-fakes.ts";
import { MemoryInstantEvalRateLimiter } from "../../__tests__/support/instant-eval-rate-limiter.test-fakes.ts";
import type { InstantEvalLlmJudgeAnswer } from "../../channels/instant-eval-llm-judge.channel.ts";
import { InstantEvalJudgeRouterService } from "../instant-eval-judge-router.service.ts";

const Q = yesNo("q", "is the user upset");

const PRICING: InstantEvalJudgeRoutePricing = {
  version: "test",
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

type Script = (
  signal?: AbortSignal,
  questions?: readonly InstantEvalQuestion[],
) => InstantEvalJudgement | Promise<InstantEvalJudgement>;

function harness({
  decisions = () => judged(0.05),
  jev = () => judged(0.5),
  llm = () => llmSays(true),
  hasDecisions = true,
  table = syntheticRouteTable(),
  limiter = MemoryInstantEvalRateLimiter.create(),
}: {
  decisions?: Script;
  jev?: Script;
  llm?: (signal?: AbortSignal) => InstantEvalLlmJudgeAnswer | Promise<InstantEvalLlmJudgeAnswer>;
  hasDecisions?: boolean;
  table?: InstantEvalJudgeRouteTable;
  limiter?: MemoryInstantEvalRateLimiter;
} = {}) {
  const hostedDecisions = ScriptedInstantEvalHostedDecisionsChannel.create({
    answer: (_request, signal) => decisions(signal),
  });
  const llmJudge = ScriptedInstantEvalLlmJudgeChannel.create({
    answer: (_request, signal) => llm(signal),
  });
  let jevCalls = 0;
  const jevTexts: string[] = [];
  // Paces each send through the limiter it is handed, as the HTTP classifier does.
  const classifier = MemoryInstantEvalClassifierChannel.create({
    answer: async (request, signal) => {
      jevCalls += 1;
      jevTexts.push(request.text);
      await request.limiter.acquire({ tokens: 10, tenantId: request.projectId }, signal);
      return jev(signal, request.questions);
    },
  });
  const router = InstantEvalJudgeRouterService.create({
    table,
    pricing: PRICING,
    classifier,
    hostedDecisions: hasDecisions ? hostedDecisions : undefined,
    llmJudge,
    limiter,
  });
  const classify = (
    route: InstantEvalJudgeRoute,
    questions: InstantEvalQuestion[] = [Q],
    signal?: AbortSignal,
  ) =>
    router.classify({
      projectId: "project-1",
      text: "user: late again",
      questions,
      route,
      ...(signal ? { signal } : {}),
    });
  return { classify, hostedDecisions, llmJudge, limiter, jevTexts, jevCalls: () => jevCalls };
}

/** The made-up table with short provider timeouts, and no fallback unless one is given. */
function timedTable(fallbacks: string[] = []): InstantEvalJudgeRouteTable {
  return syntheticRouteTable({
    backends: {
      "decision-a": { kind: "decisions", model: "decision-model-a", timeoutMs: 40, fallbacks },
      "decision-b": { kind: "jev", timeoutMs: 40 },
    },
  });
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

    /** @scenario "An LLM leg that fails keeps the primary verdict, flagged" */
    it("keeps the unsure primary verdict when the LLM channel throws", async () => {
      const { classify } = harness({
        decisions: () => judged(0.4),
        llm: () => {
          throw new Error("boom");
        },
      });
      const judgement = await classify(SHORT);
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.4 }]);
      expect(judgement.routing?.flags).toEqual(
        expect.arrayContaining(["escalation_failed", "llm-b_failed:classifier_failed"]),
      );
      expect(judgement.inputTokens).toBe(1000);
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

    /** @scenario "A backend that is down falls back to its configured fallback" */
    it("falls back from an LLM primary whose channel throws", async () => {
      const table = syntheticRouteTable({
        backends: {
          "llm-b": { kind: "openai_responses", model: "llm-model-b", fallbacks: ["decision-a"] },
        },
      });
      const { classify } = harness({
        table,
        decisions: () => judged(0.05),
        llm: () => {
          throw new Error("boom");
        },
      });
      const judgement = await classify({ ...SHORT, mode: "accurate" });
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.05 }]);
      expect(judgement.routing?.flags).toEqual(
        expect.arrayContaining(["llm-b_failed:classifier_failed", "fallback:llm-b->decision-a"]),
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

  describe("given a leg that runs past its own timeout", () => {
    const LONG_INSTANT: InstantEvalJudgeRoute = { job: "search", tokens: 20_000, mode: "instant" };

    /** @scenario "A leg past its own timeout is a failed leg, not a stopped page" */
    it("skips as provider unavailable instead of throwing the leg's timeout", async () => {
      const { classify } = harness({ table: timedTable(), decisions: hangUntilAborted });
      const judgement = await classify(LONG_INSTANT);
      expect(judgement.skippedReason).toBe("classifier_provider_unavailable");
      expect(judgement.routing?.flags).toContain("decision-a_timed_out");
    });

    /** @scenario "A leg past its own timeout is a failed leg, not a stopped page" */
    it("skips when both legs of a pair time out", async () => {
      const { classify } = harness({
        table: timedTable(),
        decisions: hangUntilAborted,
        jev: hangUntilAborted,
      });
      const judgement = await classify(PAIRED);
      expect(judgement.skippedReason).toBe("classifier_provider_unavailable");
    });

    /** @scenario "A leg past its own timeout is a failed leg, not a stopped page" */
    it("keeps the legs already paid for billed when the last one times out", async () => {
      const { classify } = harness({
        table: timedTable(["decision-b"]),
        decisions: () => ({ ...instantEvalSkipped("classifier_rate_limited"), inputTokens: 1000 }),
        jev: hangUntilAborted,
      });
      const judgement = await classify(LONG_INSTANT);
      expect(judgement.skippedReason).toBe("classifier_provider_unavailable");
      expect(judgement.costNanoUsd).toBe(100_000);
      expect(judgement.inputTokens).toBe(1000);
    });

    /** @scenario "A leg past its own timeout is a failed leg, not a stopped page" */
    it("rethrows the caller's own stop", async () => {
      const stop = new AbortController();
      const { classify } = harness({
        decisions: (signal) => {
          setTimeout(() => stop.abort(new DOMException("stopped", "AbortError")), 5);
          return hangUntilAborted(signal);
        },
      });
      await expect(classify(LONG_INSTANT, [Q], stop.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
    });

    /** @scenario "A leg past its own timeout is a failed leg, not a stopped page" */
    it("does not count the wait on the rate limiter against the provider timeout", async () => {
      const { classify, limiter } = harness({
        table: syntheticRouteTable({ backends: { "decision-b": { kind: "jev", timeoutMs: 40 } } }),
        limiter: MemoryInstantEvalRateLimiter.create({ waitMs: 120 }),
        jev: () => judged(0.2),
      });
      const judgement = await classify({ job: "scenario_judge", tokens: 20_000 });
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.2 }]);
      expect(limiter.permits).toHaveLength(1);
    });
  });

  /** @scenario "A route table that cannot bill or call a backend refuses to boot" */
  it("never asks the primary again as the escalation's fallback", async () => {
    const { classify, hostedDecisions } = harness({
      table: syntheticRouteTable({
        backends: { "llm-b": { kind: "openai_responses", model: "m", fallbacks: ["decision-a"] } },
      }),
      decisions: () => judged(0.4),
      llm: () => ({
        outcome: "skipped",
        reason: "classifier_failed",
        inputTokens: 0,
        outputTokens: 0,
      }),
    });
    const judgement = await classify(SHORT);
    expect(hostedDecisions.requests).toHaveLength(1);
    expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.4 }]);
  });

  /** @scenario "Decisions and LLM legs draw on the rate limiter too" */
  it("paces Decisions and every LLM send through the limiter, each kind on its own share", async () => {
    const { classify, limiter } = harness({ decisions: () => judged(0.5) });
    await classify(SHORT, [Q, yesNo("q2", "did the user say thanks")]);
    expect(limiter.permits.map((permit) => permit.tenantId)).toEqual([
      "project-1:decisions",
      "project-1:llm",
      "project-1:llm",
    ]);
    expect(limiter.permits.every((permit) => permit.tokens > 0)).toBe(true);
  });

  /** @scenario "A caller's stop keeps the legs already paid billed" */
  it("carries the paid legs' spend on a caller's stop during the escalation", async () => {
    const stop = new AbortController();
    const { classify } = harness({
      decisions: () => {
        setTimeout(() => stop.abort(new DOMException("stopped", "AbortError")), 5);
        return judged(0.4);
      },
      llm: (signal) => hangUntilAborted(signal),
    });
    const error = await classify(SHORT, [Q], stop.signal).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(InstantEvalJudgeStoppedError);
    expect(error).toMatchObject({ name: "AbortError", inputTokens: 1000, costNanoUsd: 100_000 });
  });

  /** @scenario "A caller's stop keeps the legs already paid billed" */
  it("bills the LLM answers already received when the caller stops mid-escalation", async () => {
    const stop = new AbortController();
    let sends = 0;
    const { classify } = harness({
      decisions: () => judged(0.4),
      llm: (signal) => {
        sends += 1;
        if (sends === 1) return llmSays(true);
        setTimeout(() => stop.abort(new DOMException("stopped", "AbortError")), 5);
        return hangUntilAborted(signal);
      },
    });
    const both = [Q, yesNo("q2", "is the user confused")];
    const error = await classify(SHORT, both, stop.signal).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(InstantEvalJudgeStoppedError);
    // decision-a's 1000 tokens, plus the 2000 of the one LLM answer that came back.
    expect(error).toMatchObject({ inputTokens: 3000, costNanoUsd: 100_000 + 2_500_000 });
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
    it("gives a fallback whose kind may not read the view the full trace", async () => {
      const { classify, jevTexts } = harness({ hasDecisions: false, jev: () => judged(0.2) });
      const judgement = await classify({
        job: "search",
        tokens: 20_000,
        mode: "instant",
        inputView: "text",
        views: { text: "user: late" },
      });
      expect(jevTexts).toEqual(["user: late again"]);
      expect(judgement.routing?.flags).toContain("text_view_refused:decision-b");
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

  /** @scenario "A kind the table does not route takes today's classifier call" */
  it("sends a call with a score the table does not route to the classifier whole, as before", async () => {
    const score: InstantEvalQuestion = {
      id: "s",
      kind: "score",
      instructions: "how polite",
      range: { min: 1, max: 5 },
    };
    const { classify, hostedDecisions, jevCalls } = harness({ jev: () => judged(0.5) });
    const judgement = await classify(SHORT, [Q, score]);
    expect(jevCalls()).toBe(1);
    expect(hostedDecisions.requests).toHaveLength(0);
    expect(judgement.routing).toBeUndefined();
  });

  /** @scenario "Every judgement a routed call returns carries its cost" */
  it("prices an unrouted call at the hosted classifier's routed rate, so no token bills at zero", async () => {
    const { classify } = harness({ jev: () => judged(0.5, 2000) });
    const score: InstantEvalQuestion = {
      id: "s",
      kind: "score",
      instructions: "how polite",
      range: { min: 1, max: 5 },
    };
    const judgement = await classify(SHORT, [score]);
    // decision-b is the table's hosted-classifier backend: 2000 tokens x 0.05
    expect(judgement.costNanoUsd).toBe(100_000);
  });

  describe("given score and category questions the table routes", () => {
    const table = syntheticRouteTable({ kinds: SYNTHETIC_KINDS });
    const noFallbackTable = syntheticRouteTable({
      kinds: SYNTHETIC_KINDS,
      backends: { "decision-a": { kind: "decisions", model: "decision-model-a" } },
    });
    const POLITE = rating("polite", "how polite is the reply, 1 to 5");
    const TOPIC = choiceOf("topic", "which topic is this", ["billing", "shipping", "other"]);
    const scored = (spread?: number): InstantEvalJudgement => ({
      verdicts: [{ questionId: "polite", score: 4.1, ...(spread === undefined ? {} : { spread }) }],
      inputTokens: 1000,
      isTextTruncated: false,
    });
    const labelled = (probabilities: Record<string, number>): InstantEvalJudgement => ({
      verdicts: [{ questionId: "topic", label: "billing", probabilities }],
      inputTokens: 1000,
      isTextTruncated: false,
    });

    /** @scenario "A sure score or category answer stays, by its kind's sureness rule" */
    it("keeps a score whose spread is small against the range, from the kind's default slot", async () => {
      const { classify, llmJudge } = harness({ table, decisions: () => scored(0.3) });
      const judgement = await classify({ job: "llm_judge", tokens: 500 }, [POLITE]);
      expect(judgement.verdicts).toEqual([{ questionId: "polite", score: 4.1, spread: 0.3 }]);
      expect(judgement.routing).toMatchObject({ slot: "default", escalated: 0 });
      expect(llmJudge.requests).toHaveLength(0);
    });

    /** @scenario "An unsure score or category answer escalates to the LLM leg" */
    it("escalates a widely spread score, or one with no distribution, to the LLM's score", async () => {
      for (const spread of [1.5, undefined]) {
        const { classify, llmJudge } = harness({
          table,
          decisions: () => scored(spread),
          llm: () => ({ outcome: "answered", score: 2, inputTokens: 900, outputTokens: 80 }),
        });
        const judgement = await classify({ job: "llm_judge", tokens: 500 }, [POLITE]);
        expect(judgement.verdicts).toEqual([{ questionId: "polite", score: 2 }]);
        expect(judgement.routing).toMatchObject({ answeredBy: { "llm-a": 1 }, escalated: 1 });
        expect(llmJudge.requests[0]?.question).toEqual(POLITE);
      }
    });

    /** @scenario "An unsure score or category answer escalates to the LLM leg" */
    it("escalates a category whose top two options are close, keeping the LLM's label as certain", async () => {
      const { classify } = harness({
        table,
        decisions: () => labelled({ billing: 0.5, shipping: 0.4, other: 0.1 }),
        llm: () => ({ outcome: "answered", label: "shipping", inputTokens: 900, outputTokens: 80 }),
      });
      const judgement = await classify({ job: "search", tokens: 500 }, [TOPIC]);
      expect(judgement.verdicts).toEqual([
        {
          questionId: "topic",
          label: "shipping",
          probabilities: { billing: 0, shipping: 1, other: 0 },
        },
      ]);
      expect(judgement.routing).toMatchObject({ answeredBy: { "llm-b": 1 }, escalated: 1 });
    });

    /** @scenario "The confident pair keeps the more confident answer" */
    it("keeps the category answer with the wider margin from a pair", async () => {
      const { classify } = harness({
        table,
        decisions: () => labelled({ billing: 0.55, shipping: 0.45 }),
        jev: () => ({
          verdicts: [
            { questionId: "topic", label: "other", probabilities: { other: 0.9, billing: 0.1 } },
          ],
          inputTokens: 1000,
          isTextTruncated: false,
        }),
      });
      const judgement = await classify({ job: "llm_judge", tokens: 500, mode: "instant" }, [TOPIC]);
      expect(judgement.verdicts[0]?.label).toBe("other");
      expect(judgement.routing).toMatchObject({ slot: "short", answeredBy: { "decision-b": 1 } });
    });

    /** @scenario "Questions of several kinds in one call are routed per kind and merged in order" */
    it("plans each kind on its own and merges the verdicts in the order asked", async () => {
      const { classify, hostedDecisions } = harness({
        table,
        decisions: () => {
          const asked = hostedDecisions.requests.at(-1)?.questions[0]?.id;
          if (asked === "polite") return scored(0.2);
          if (asked === "topic") return labelled({ billing: 0.9, other: 0.1 });
          return judged(0.05);
        },
      });
      const judgement = await classify({ job: "llm_judge", tokens: 500 }, [TOPIC, Q, POLITE]);
      expect(judgement.verdicts.map((verdict) => verdict.questionId)).toEqual([
        "topic",
        "q",
        "polite",
      ]);
      const kindsAsked = hostedDecisions.requests.map((request) =>
        request.questions.map((q) => q.kind).join(","),
      );
      expect(kindsAsked.toSorted()).toEqual(["boolean", "category", "score"]);
      // The category's short llm_judge slot pairs with the classifier, paid but not answering it.
      expect(judgement.inputTokens).toBe(4000);
      expect(judgement.routing?.answeredBy).toEqual({ "decision-a": 3 });
    });

    /** @scenario "An LLM leg that fails keeps the primary verdict, flagged" */
    it("keeps an unsure score when the LLM answers nothing readable", async () => {
      const { classify } = harness({
        table,
        decisions: () => scored(1.8),
        llm: () => ({
          outcome: "skipped",
          reason: "classifier_failed",
          inputTokens: 900,
          outputTokens: 80,
        }),
      });
      const judgement = await classify({ job: "llm_judge", tokens: 500 }, [POLITE]);
      expect(judgement.verdicts).toEqual([{ questionId: "polite", score: 4.1, spread: 1.8 }]);
      expect(judgement.routing?.flags).toContain("escalation_failed");
    });
    /** @scenario "A kind the table does not route takes today's classifier call" */
    it("sends a call with a malformed score or category question to the classifier whole", async () => {
      for (const odd of [
        rating("polite", "how polite", { min: 5, max: 1 }),
        rating("polite", "how polite", { min: 0, max: 0.5 }),
        choiceOf("topic", "which", []),
        choiceOf("topic", "which", ["billing", "billing"]),
      ]) {
        const { classify, hostedDecisions, jevCalls } = harness({ table });
        await classify({ job: "llm_judge", tokens: 500 }, [Q, odd]);
        expect(jevCalls()).toBe(1);
        expect(hostedDecisions.requests).toHaveLength(0);
      }
    });

    /** @scenario "The confident pair keeps the more confident answer" */
    it("keeps the score with the smaller spread from a pair", async () => {
      const pairTable = syntheticRouteTable({
        kinds: {
          score: {
            sureness: "spread",
            default: { instant: { primary: "decision-a", pairWith: "decision-b" } },
          },
        },
      });
      const { classify } = harness({
        table: pairTable,
        decisions: () => scored(1.2),
        jev: () => ({
          verdicts: [{ questionId: "polite", score: 2, spread: 0.2 }],
          inputTokens: 1000,
          isTextTruncated: false,
        }),
      });
      const judgement = await classify({ job: "search", tokens: 500 }, [POLITE]);
      expect(judgement.verdicts).toEqual([{ questionId: "polite", score: 2, spread: 0.2 }]);
      expect(judgement.routing?.answeredBy).toEqual({ "decision-b": 1 });
    });

    /** @scenario "Questions of several kinds in one call are routed per kind and merged in order" */
    it("skips only the kind whose run threw when another kind answered, keeping its spend", async () => {
      // scenario_judge asks yes or no of the classifier alone and a score of Decisions alone.
      const { classify } = harness({
        table: noFallbackTable,
        decisions: () => {
          throw new Error("socket closed");
        },
        jev: () => judged(0.05),
      });
      const judgement = await classify({ job: "scenario_judge", tokens: 500 }, [POLITE, Q]);
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.05 }]);
      expect(judgement.skippedReason).toBeUndefined();
      expect(judgement.inputTokens).toBe(1000);
      expect(judgement.routing?.flags).toContain("score:skipped:classifier_failed");
    });

    /** @scenario "Questions of several kinds in one call are routed per kind and merged in order" */
    it("keeps the spend of a kind whose run threw after a paid leg", async () => {
      // The score's Decisions primary is paid and skips; its classifier fallback throws.
      const { classify } = harness({
        table,
        decisions: () => ({ ...instantEvalSkipped("classifier_rate_limited"), inputTokens: 1000 }),
        jev: (_signal, asked) => {
          if (asked?.some((question) => question.kind === "score"))
            throw new Error("socket closed");
          return judged(0.05);
        },
      });
      const judgement = await classify({ job: "scenario_judge", tokens: 500 }, [POLITE, Q]);
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.05 }]);
      expect(judgement.inputTokens).toBe(2000);
      expect(judgement.routing?.flags).toContain("score:skipped:classifier_failed");
    });

    /** @scenario "Questions of several kinds in one call are routed per kind and merged in order" */
    it("rethrows when no kind answered, as an unrouted call would", async () => {
      const { classify } = harness({
        table: noFallbackTable,
        decisions: () => {
          throw new Error("socket closed");
        },
        jev: () => {
          throw new Error("socket closed");
        },
      });
      await expect(classify({ job: "scenario_judge", tokens: 500 }, [POLITE, Q])).rejects.toThrow(
        "socket closed",
      );
    });

    /** @scenario "Questions of several kinds in one call are routed per kind and merged in order" */
    it("carries every kind's paid spend on a caller's stop", async () => {
      const stop = new AbortController();
      let booleanAnswered: () => void = () => undefined;
      const answered = new Promise<void>((resolve) => {
        booleanAnswered = resolve;
      });
      const { classify, hostedDecisions } = harness({
        table,
        decisions: async (signal) => {
          const asked = hostedDecisions.requests.at(-1)?.questions[0];
          if (asked?.kind === "boolean") {
            booleanAnswered();
            return judged(0.05);
          }
          const hung = hangUntilAborted<InstantEvalJudgement>(signal);
          await answered;
          stop.abort();
          return hung;
        },
      });
      const error = await classify(
        { job: "llm_judge", tokens: 500 },
        [POLITE, Q],
        stop.signal,
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(InstantEvalJudgeStoppedError);
      expect((error as InstantEvalJudgeStoppedError).inputTokens).toBe(1000);
    });
  });
});
