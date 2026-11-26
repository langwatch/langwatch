/**
 * The router's gate over scripted channels: an easy case answered by the primary alone, the rest
 * by the escalation alone, a gate that cannot rate, a branch that is down, and what is billed.
 * No network.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  InstantEvalJudgeStoppedError,
  instantEvalSkipped,
  type InstantEvalJudgement,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeRouteRequest,
  type InstantEvalJudgeRouteTable,
  type InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import { MemoryInstantEvalClassifierChannel } from "../../__tests__/support/instant-eval-classifier.test-fakes.ts";
import {
  gatedRouteTable,
  rating,
  yesNo,
} from "../../__tests__/support/instant-eval-judge-route.test-fakes.ts";
import {
  hangUntilAborted,
  ScriptedInstantEvalHostedDecisionsChannel,
  ScriptedInstantEvalLlmJudgeChannel,
} from "../../__tests__/support/instant-eval-judge-router.test-fakes.ts";
import { MemoryInstantEvalRateLimiter } from "../../__tests__/support/instant-eval-rate-limiter.test-fakes.ts";
import type { InstantEvalClassifyRequest } from "../../channels/instant-eval-classifier.channel.ts";
import type {
  InstantEvalLlmJudgeAnswer,
  InstantEvalLlmJudgeRequest,
} from "../../channels/instant-eval-llm-judge.channel.ts";
import { InstantEvalJudgeRouterService } from "../instant-eval-judge-router.service.ts";

const Q = yesNo("q", "is the user upset");
const Q2 = yesNo("q2", "is the user confused");
const TEXT = "user: late again";

const PRICING: InstantEvalJudgeRoutePricing = {
  version: "test",
  backends: {
    "gate-a": { usdPerMillionInputTokens: 0.05, usdPerMillionOutputTokens: 0 },
    "decision-a": { usdPerMillionInputTokens: 0.1, usdPerMillionOutputTokens: 0 },
    "llm-a": { usdPerMillionInputTokens: 2, usdPerMillionOutputTokens: 8 },
    "llm-b": { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 5 },
  },
};

/** Nano-USD: the gate's 400 tokens, a Decisions answer's 1000, an LLM answer's 2000 in, 100 out. */
const GATE_COST = 20_000;
const DECISIONS_COST = 100_000;
const LLM_COST = 2_000_000 + 500_000;

type GateAnswer = InstantEvalJudgement | Promise<InstantEvalJudgement>;

/** The gate's answer: a difficulty score for the one question it was asked. */
const rated =
  (score: number) =>
  (request: InstantEvalClassifyRequest): InstantEvalJudgement => ({
    verdicts: [{ questionId: request.questions[0]!.id, score }],
    inputTokens: 400,
    isTextTruncated: false,
  });

/** The gate answered and billed, with nothing a score can be read from. */
const unrated = (): InstantEvalJudgement => ({
  verdicts: [],
  inputTokens: 400,
  isTextTruncated: false,
});

const decided = (probability: number, questionId = Q.id): InstantEvalJudgement => ({
  verdicts: [{ questionId, probability }],
  inputTokens: 1000,
  isTextTruncated: false,
});

const llmSays = (verdict: boolean): InstantEvalLlmJudgeAnswer => ({
  outcome: "answered",
  verdict,
  inputTokens: 2000,
  outputTokens: 100,
});

const llmDown: InstantEvalLlmJudgeAnswer = {
  outcome: "skipped",
  reason: "classifier_provider_unavailable",
  inputTokens: 0,
  outputTokens: 0,
};

/** A wait that ends only once two callers are waiting on it, so it hangs for asks made in turn. */
function bothArrived(): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const both = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    arrived += 1;
    if (arrived === 2) release();
    return both;
  };
}

function harness({
  gate = rated(0),
  decisions = () => decided(0.9),
  llm = () => llmSays(false),
  table = gatedRouteTable(),
}: {
  gate?: (request: InstantEvalClassifyRequest, signal?: AbortSignal) => GateAnswer;
  decisions?: (questions: readonly InstantEvalQuestion[]) => GateAnswer;
  llm?: (
    request: InstantEvalLlmJudgeRequest,
    signal?: AbortSignal,
  ) => InstantEvalLlmJudgeAnswer | Promise<InstantEvalLlmJudgeAnswer>;
  table?: InstantEvalJudgeRouteTable;
} = {}) {
  const gateRequests: InstantEvalClassifyRequest[] = [];
  const classifier = MemoryInstantEvalClassifierChannel.create({
    answer: async (request, signal) => {
      gateRequests.push(request);
      return gate(request, signal);
    },
  });
  const hostedDecisions = ScriptedInstantEvalHostedDecisionsChannel.create({
    answer: (request) => decisions(request.questions),
  });
  const llmJudge = ScriptedInstantEvalLlmJudgeChannel.create({ answer: llm });
  const router = InstantEvalJudgeRouterService.create({
    table,
    pricing: PRICING,
    classifier,
    hostedDecisions,
    llmJudge,
    limiter: MemoryInstantEvalRateLimiter.create(),
    logger: { error: () => undefined, warn: () => undefined },
  });
  const classify = (
    questions: InstantEvalQuestion[] = [Q],
    route: InstantEvalJudgeRouteRequest = { job: "llm_judge" },
    signal?: AbortSignal,
  ) =>
    router.classify({
      projectId: "project-1",
      text: TEXT,
      questions,
      route,
      ...(signal ? { signal } : {}),
    });
  return { classify, gateRequests, hostedDecisions, llmJudge };
}

describe("InstantEvalJudgeRouterService, given a gated plan", () => {
  describe("when the gate rates the case under the threshold", () => {
    /** @scenario "A gate sends an easy case to the primary alone and the rest to the escalation alone" */
    it("answers from the primary alone, however unsure, and bills the gate and that one leg", async () => {
      const { classify, hostedDecisions, llmJudge } = harness({
        gate: rated(1.49),
        decisions: () => decided(0.5),
      });
      const judgement = await classify();
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.5 }]);
      expect(judgement.routing).toMatchObject({
        answeredBy: { "decision-a": 1 },
        escalated: 0,
        mode: "balanced",
        flags: ["gate:easy"],
      });
      expect(hostedDecisions.requests).toHaveLength(1);
      expect(hostedDecisions.requests[0]?.text).toBe(TEXT);
      expect(llmJudge.requests).toHaveLength(0);
      expect(judgement.costNanoUsd).toBe(GATE_COST + DECISIONS_COST);
      expect(judgement.inputTokens).toBe(400 + 1000);
    });

    /** @scenario "A gate sends an easy case to the primary alone and the rest to the escalation alone" */
    it("counts the gate's limiter wait toward the judgement's, with the primary's", async () => {
      const { classify } = harness({
        gate: (request) => ({ ...rated(1)(request), limiterWaitMs: 30 }),
        decisions: () => ({ ...decided(0.5), limiterWaitMs: 7 }),
      });
      const judgement = await classify();
      expect(judgement.routing?.flags).toEqual(["gate:easy"]);
      expect(judgement.limiterWaitMs).toBe(30 + 7);
    });
  });

  describe("when the gate rates the case at or above the threshold", () => {
    /** @scenario "A gate sends an easy case to the primary alone and the rest to the escalation alone" */
    it("answers from the escalation alone, on the full text, and never asks the primary", async () => {
      const { classify, hostedDecisions, llmJudge } = harness({
        gate: rated(1.5),
        llm: () => llmSays(true),
      });
      const judgement = await classify();
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 1 }]);
      expect(judgement.routing).toMatchObject({
        answeredBy: { "llm-b": 1 },
        escalated: 0,
        flags: ["gate:hard"],
      });
      expect(hostedDecisions.requests).toHaveLength(0);
      expect(llmJudge.requests).toHaveLength(1);
      expect(llmJudge.requests[0]).toMatchObject({ wire: "openai_responses", text: TEXT });
      expect(judgement.costNanoUsd).toBe(GATE_COST + LLM_COST);
      expect(judgement.inputTokens).toBe(400 + 2000);
    });

    /** @scenario "A gate sends an easy case to the primary alone and the rest to the escalation alone" */
    it("counts the gate's limiter wait toward the judgement's, with the escalation's", async () => {
      const { classify } = harness({
        gate: (request) => ({ ...rated(3)(request), limiterWaitMs: 30 }),
        llm: () => llmSays(true),
      });
      const judgement = await classify();
      expect(judgement.routing?.flags).toEqual(["gate:hard"]);
      // An LLM leg reports no limiter wait of its own, so only the gate's counts.
      expect(judgement.limiterWaitMs).toBe(30 + 0);
    });

    /** @scenario "A reasoning effort is sent only when the backend sets one" */
    it("asks the LLM leg at the effort its backend sets, and at none when it sets none", async () => {
      const set = harness({ gate: rated(4) });
      await set.classify();
      expect(set.llmJudge.requests[0]?.reasoningEffort).toBe("high");

      const unset = harness({
        gate: rated(4),
        table: gatedRouteTable({
          backends: { "llm-b": { kind: "openai_responses", model: "llm-model-b" } },
        }),
      });
      await unset.classify();
      expect(unset.llmJudge.requests[0]).not.toHaveProperty("reasoningEffort");
    });
  });

  describe("when the gate is asked", () => {
    /** @scenario "The gate reads a frozen framing of the case" */
    it("sends the hosted classifier one named-level score question over the framed case", async () => {
      const { classify, gateRequests } = harness();
      await classify();
      expect(gateRequests).toHaveLength(1);
      const [request] = gateRequests;
      expect(request?.text).toContain("You are NOT asked for the verdict");
      expect(request?.text).toContain("Job: LLM-as-a-judge evaluator");
      expect(request?.text).toContain("Task: is the user upset\n");
      expect(request?.text).toContain(`<text>\n${TEXT}\n</text>`);
      expect(request?.questions).toHaveLength(1);
      expect(request?.questions[0]).toMatchObject({
        id: "q",
        kind: "score",
        range: { min: 0, max: 4 },
      });
      expect(request?.questions[0]).toHaveProperty("levels");
    });

    /** @scenario "A gate rates each question of a call on its own" */
    it("rates each question on its own send, and each branch answers its own questions", async () => {
      const { classify, gateRequests, hostedDecisions, llmJudge } = harness({
        gate: (request) =>
          rated(request.text.includes("Task: is the user upset") ? 0.2 : 3.4)(request),
        decisions: (questions) => decided(0.9, questions[0]!.id),
        llm: () => llmSays(false),
      });
      const judgement = await classify([Q, Q2]);
      expect(gateRequests).toHaveLength(2);
      expect(hostedDecisions.requests.map((r) => r.questions.map((q) => q.id))).toEqual([["q"]]);
      expect(llmJudge.requests.map((r) => r.question.id)).toEqual(["q2"]);
      expect(judgement.verdicts).toEqual([
        { questionId: "q", probability: 0.9 },
        { questionId: "q2", probability: 0 },
      ]);
      expect(judgement.routing).toMatchObject({
        answeredBy: { "decision-a": 1, "llm-b": 1 },
        escalated: 0,
        flags: ["gate:easy", "gate:hard"],
      });
      expect(judgement.costNanoUsd).toBe(2 * GATE_COST + DECISIONS_COST + LLM_COST);
    });

    /** @scenario "A gate rates each question of a call on its own" */
    it("sends both gate asks, then both branches, side by side", async () => {
      // Each fake answers only once both of its pair have arrived, so asking in turn hangs: the
      // second gate send never starts, the first times out, and both branches would go hard;
      // a branch awaited before the other started hangs past this test's timeout.
      const gateBoth = bothArrived();
      const branchesBoth = bothArrived();
      const { classify } = harness({
        gate: async (request) => {
          await gateBoth();
          return rated(request.text.includes("Task: is the user upset") ? 0.2 : 3.4)(request);
        },
        decisions: async (questions) => {
          await branchesBoth();
          return decided(0.9, questions[0]!.id);
        },
        llm: async () => {
          await branchesBoth();
          return llmSays(false);
        },
      });
      const judgement = await classify([Q, Q2]);
      expect(judgement.routing).toMatchObject({
        answeredBy: { "decision-a": 1, "llm-b": 1 },
        escalated: 0,
        flags: ["gate:easy", "gate:hard"],
      });
    }, 1_000);

    /** @scenario "A gate rates each question of a call on its own" */
    it("reports the longest of the side-by-side waits, never their sum", async () => {
      const { classify } = harness({
        gate: (request) => {
          const isFirst = request.text.includes("Task: is the user upset");
          return { ...rated(isFirst ? 0.2 : 3.4)(request), limiterWaitMs: isFirst ? 30 : 50 };
        },
        // The easy branch's ask waits 7; the hard branch's escalation is down and its fallback onto
        // the primary waits 11.
        decisions: (questions) => ({
          ...decided(0.9, questions[0]!.id),
          limiterWaitMs: questions[0]!.id === "q" ? 7 : 11,
        }),
        llm: () => llmDown,
      });
      const judgement = await classify([Q, Q2]);
      expect(judgement.routing?.flags).toEqual(
        expect.arrayContaining(["gate:easy", "gate:hard", "gate_hard_failed"]),
      );
      // Two gate sends side by side (30 and 50), then the two branches side by side (7 and 11).
      expect(judgement.limiterWaitMs).toBe(50 + 11);
    });
  });

  describe("when the call renders a partial view the primary may judge", () => {
    const VIEW = "rendered view: wording only";
    const viewed = (difficulty: number) =>
      harness({
        gate: rated(difficulty),
        table: gatedRouteTable({
          inputViews: {
            default: "text",
            byCategory: {},
            allowedKinds: { text: ["decisions"], tools: [] },
          },
        }),
      });
    const route: InstantEvalJudgeRouteRequest = { job: "llm_judge", views: { text: VIEW } };

    /** @scenario "The gate reads a frozen framing of the case" */
    it("frames the full text for the gate, not the view", async () => {
      const { classify, gateRequests } = viewed(3);
      await classify([Q], route);
      expect(gateRequests).toHaveLength(1);
      expect(gateRequests[0]?.text).toContain(`<text>\n${TEXT}\n</text>`);
      expect(gateRequests[0]?.text).not.toContain(VIEW);
    });

    /** @scenario "A gate sends an easy case to the primary alone and the rest to the escalation alone" */
    it("asks the primary on the view for an easy case and the escalation on the full text for a hard one", async () => {
      const easy = viewed(0);
      await easy.classify([Q], route);
      expect(easy.hostedDecisions.requests[0]?.text).toBe(VIEW);

      const hard = viewed(3);
      const judgement = await hard.classify([Q], route);
      expect(judgement.routing).toMatchObject({ inputView: "text", answeredBy: { "llm-b": 1 } });
      expect(hard.llmJudge.requests).toHaveLength(1);
      expect(hard.llmJudge.requests[0]?.text).toBe(TEXT);
    });
  });

  describe("when the gate cannot rate the case", () => {
    /** @scenario "A gate that gives no score sends the case to the escalation" */
    it("sends a case with no readable score to the escalation, still billing the gate", async () => {
      const { classify, hostedDecisions } = harness({ gate: unrated, llm: () => llmSays(true) });
      const judgement = await classify();
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 1 }]);
      expect(judgement.routing?.flags).toEqual([
        "gate-a_failed:classifier_provider_unavailable",
        "gate_no_score",
        "gate:hard",
      ]);
      expect(hostedDecisions.requests).toHaveLength(0);
      expect(judgement.costNanoUsd).toBe(GATE_COST + LLM_COST);
    });

    /** @scenario "A gate that gives no score sends the case to the escalation" */
    it("sends the case to the escalation when the gate runs past its timeout", async () => {
      const { classify, hostedDecisions } = harness({
        gate: (_request, signal) => hangUntilAborted(signal),
        llm: () => llmSays(true),
      });
      const judgement = await classify();
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 1 }]);
      expect(judgement.routing).toMatchObject({ answeredBy: { "llm-b": 1 }, escalated: 0 });
      expect(judgement.routing?.flags).toEqual(
        expect.arrayContaining(["gate-a_timed_out", "gate_no_score", "gate:hard"]),
      );
      expect(hostedDecisions.requests).toHaveLength(0);
      expect(judgement.costNanoUsd).toBe(LLM_COST);
    });

    /** @scenario "A gate that gives no score sends the case to the escalation" */
    it("sends the case to the escalation when the gate skips or its channel throws", async () => {
      const skipping = harness({ gate: () => instantEvalSkipped("classifier_rate_limited") });
      expect((await skipping.classify()).routing).toMatchObject({ answeredBy: { "llm-b": 1 } });

      const throwing = harness({
        gate: () => {
          throw new Error("boom");
        },
      });
      const judgement = await throwing.classify();
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0 }]);
      expect(judgement.routing?.flags).toEqual(
        expect.arrayContaining(["gate-a_failed:classifier_failed", "gate_no_score"]),
      );
    });
  });

  describe("when the branch the gate picked cannot answer", () => {
    /** @scenario "A gated branch that cannot answer is answered by the other backend, flagged" */
    it("answers an easy case from the escalation when the primary is down", async () => {
      const { classify, llmJudge } = harness({
        gate: rated(0),
        decisions: () => instantEvalSkipped("classifier_rate_limited"),
        llm: () => llmSays(true),
      });
      const judgement = await classify();
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 1 }]);
      expect(judgement.routing).toMatchObject({ answeredBy: { "llm-b": 1 }, escalated: 1 });
      expect(judgement.routing?.flags).toEqual(
        expect.arrayContaining(["gate:easy", "primary_failed"]),
      );
      expect(llmJudge.requests).toHaveLength(1);
    });

    /** @scenario "A gated branch that cannot answer is answered by the other backend, flagged" */
    it("answers a hard case from the primary when the escalation is down", async () => {
      const { classify, hostedDecisions, llmJudge } = harness({
        gate: rated(4),
        llm: () => llmDown,
        decisions: () => decided(0.8),
      });
      const judgement = await classify();
      expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.8 }]);
      expect(judgement.routing).toMatchObject({ answeredBy: { "decision-a": 1 }, escalated: 0 });
      expect(judgement.routing?.flags).toEqual(
        expect.arrayContaining(["gate:hard", "gate_hard_failed"]),
      );
      expect(llmJudge.requests).toHaveLength(1);
      expect(hostedDecisions.requests).toHaveLength(1);
      expect(judgement.costNanoUsd).toBe(GATE_COST + DECISIONS_COST);
    });

    /** @scenario "A gated branch that cannot answer is answered by the other backend, flagged" */
    it("asks the escalation only for the easy questions the primary left unanswered", async () => {
      const { classify, hostedDecisions, llmJudge } = harness({
        gate: rated(0),
        decisions: () => decided(0.9, Q.id),
        llm: () => llmSays(true),
      });
      const judgement = await classify([Q, Q2]);
      expect(hostedDecisions.requests.map((r) => r.questions.map((q) => q.id))).toEqual([
        ["q", "q2"],
      ]);
      expect(llmJudge.requests.map((r) => r.question.id)).toEqual(["q2"]);
      expect(judgement.verdicts).toEqual([
        { questionId: "q", probability: 0.9 },
        { questionId: "q2", probability: 1 },
      ]);
      expect(judgement.routing).toMatchObject({
        answeredBy: { "decision-a": 1, "llm-b": 1 },
        escalated: 1,
      });
      expect(judgement.routing?.flags).toEqual(
        expect.arrayContaining(["gate:easy", "primary_failed"]),
      );
      expect(judgement.costNanoUsd).toBe(2 * GATE_COST + DECISIONS_COST + LLM_COST);
    });

    describe("and its backend lists the other backend as a fallback", () => {
      /** @scenario "A gated branch that cannot answer is answered by the other backend, flagged" */
      it("asks the escalation once for an easy case, as the flagged other ask", async () => {
        const { classify, llmJudge } = harness({
          table: gatedRouteTable({
            backends: {
              "decision-a": {
                kind: "decisions",
                model: "decision-model-a",
                fallbacks: ["llm-b"],
              },
            },
          }),
          gate: rated(0),
          decisions: () => {
            throw new Error("decisions down");
          },
          llm: () => llmSays(true),
        });
        const judgement = await classify();
        expect(llmJudge.requests).toHaveLength(1);
        expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 1 }]);
        expect(judgement.routing).toMatchObject({ answeredBy: { "llm-b": 1 } });
        expect(judgement.routing?.flags).toEqual(
          expect.arrayContaining(["gate:easy", "primary_failed"]),
        );
        expect(judgement.costNanoUsd).toBe(GATE_COST + LLM_COST);
      });

      /** @scenario "A gated branch that cannot answer is answered by the other backend, flagged" */
      it("asks the escalation once when it is down too, so it is never billed twice", async () => {
        const { classify, llmJudge } = harness({
          table: gatedRouteTable({
            backends: {
              "decision-a": {
                kind: "decisions",
                model: "decision-model-a",
                fallbacks: ["llm-b"],
              },
            },
          }),
          gate: rated(0),
          decisions: () => instantEvalSkipped("classifier_rate_limited"),
          llm: () => llmDown,
        });
        const judgement = await classify();
        expect(llmJudge.requests).toHaveLength(1);
        expect(judgement.verdicts).toEqual([]);
      });

      /** @scenario "A gated branch that cannot answer is answered by the other backend, flagged" */
      it("asks the primary once for a hard case, as the flagged other ask", async () => {
        const { classify, hostedDecisions, llmJudge } = harness({
          table: gatedRouteTable({
            backends: {
              "llm-b": {
                kind: "openai_responses",
                model: "llm-model-b",
                fallbacks: ["decision-a"],
              },
            },
          }),
          gate: rated(4),
          llm: () => llmDown,
          decisions: () => decided(0.8),
        });
        const judgement = await classify();
        expect(llmJudge.requests).toHaveLength(1);
        expect(hostedDecisions.requests).toHaveLength(1);
        expect(judgement.verdicts).toEqual([{ questionId: "q", probability: 0.8 }]);
        expect(judgement.routing).toMatchObject({ answeredBy: { "decision-a": 1 } });
        expect(judgement.routing?.flags).toEqual(
          expect.arrayContaining(["gate:hard", "gate_hard_failed"]),
        );
        expect(judgement.costNanoUsd).toBe(GATE_COST + DECISIONS_COST);
      });
    });

    /** @scenario "A gated branch that cannot answer is answered by the other backend, flagged" */
    it("skips with the platform's reason when neither can, keeping the gate billed", async () => {
      const { classify } = harness({
        gate: rated(4),
        llm: () => llmDown,
        decisions: () => instantEvalSkipped("classifier_rate_limited"),
      });
      const judgement = await classify();
      expect(judgement.verdicts).toEqual([]);
      expect(judgement.skippedReason).toBe("classifier_rate_limited");
      expect(judgement.costNanoUsd).toBe(GATE_COST);
      expect(judgement.inputTokens).toBe(400);
    });
  });

  describe("when the caller stops the call", () => {
    /** @scenario "A caller's stop keeps the legs already paid billed" */
    it("carries the gate's spend when the stop lands during the branch", async () => {
      const stop = new AbortController();
      const { classify } = harness({
        gate: rated(4),
        llm: (_request, signal) => {
          setTimeout(() => stop.abort(new DOMException("stopped", "AbortError")), 5);
          return hangUntilAborted(signal);
        },
      });
      const error = await classify([Q], { job: "llm_judge" }, stop.signal).catch(
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(InstantEvalJudgeStoppedError);
      expect(error).toMatchObject({ name: "AbortError", inputTokens: 400, costNanoUsd: GATE_COST });
    });

    /** @scenario "A caller's stop keeps the legs already paid billed" */
    it("rethrows the bare stop when it lands on the gate, before anything was paid", async () => {
      const stop = new AbortController();
      const { classify, llmJudge } = harness({
        gate: (_request, signal) => {
          setTimeout(() => stop.abort(new DOMException("stopped", "AbortError")), 5);
          return hangUntilAborted(signal);
        },
      });
      const error = await classify([Q], { job: "llm_judge" }, stop.signal).catch(
        (thrown: unknown) => thrown,
      );
      expect(error).toMatchObject({ name: "AbortError" });
      expect(error).not.toBeInstanceOf(InstantEvalJudgeStoppedError);
      expect(llmJudge.requests).toHaveLength(0);
    });
  });

  describe("when a backend of the gated entry is switched off", () => {
    /** @scenario "A mode with no usable entry falls back to the next cheaper mode" */
    it.each(["gate-a", "decision-a"])(
      "answers from the instant entry and never asks the gate, with %s off",
      async (off) => {
        const backends = {
          "gate-a": { kind: "jev", enabled: off !== "gate-a" },
          "decision-a": {
            kind: "decisions",
            model: "decision-model-a",
            enabled: off !== "decision-a",
          },
        };
        const { classify, gateRequests, hostedDecisions } = harness({
          table: gatedRouteTable({ backends }),
          llm: () => llmSays(true),
        });
        const judgement = await classify();
        expect(judgement.routing).toMatchObject({
          answeredBy: { "llm-b": 1 },
          mode: "instant",
          flags: [],
        });
        expect(gateRequests).toHaveLength(0);
        expect(hostedDecisions.requests).toHaveLength(0);
      },
    );
  });

  describe("when the call also asks a kind the table routes ungated", () => {
    /** @scenario "Questions of several kinds in one call are routed per kind and merged in order" */
    it("gates the yes-or-no question and routes the score apart, merged in the order asked", async () => {
      const polite = rating("polite", "how polite is the reply");
      const table = gatedRouteTable();
      const { classify, gateRequests, llmJudge } = harness({
        gate: rated(0.2),
        decisions: () => decided(0.9),
        llm: () => ({ outcome: "answered", score: 4, inputTokens: 2000, outputTokens: 100 }),
        table: {
          ...table,
          kinds: {
            score: { sureness: "spread", default: { instant: { primary: "llm-b" } }, routes: {} },
          },
        },
      });
      const judgement = await classify([polite, Q]);
      expect(gateRequests.map((r) => r.questions[0]?.id)).toEqual(["q"]);
      expect(llmJudge.requests.map((r) => r.question.id)).toEqual(["polite"]);
      expect(judgement.verdicts).toEqual([
        { questionId: "polite", score: 4 },
        { questionId: "q", probability: 0.9 },
      ]);
      expect(judgement.routing?.flags).toEqual(["boolean:gate:easy"]);
    });
  });
});
