/**
 * Sureness per question kind, the kind slot lookup and the merge of a mixed-kind call: pure
 * rules over made-up tables. No network.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import { describe, expect, it } from "vitest";

import {
  choiceOf,
  rating,
  SYNTHETIC_KINDS,
  syntheticRouteTable,
  yesNo,
} from "../../__tests__/support/instant-eval-judge-route.test-fakes.ts";
import { instantEvalJudgeRouteBootIssues } from "../instant-eval-judge-route-boot.rules.ts";
import {
  instantEvalJudgeFirstSendLeadsOf,
  instantEvalJudgeKindGroupsOf,
  instantEvalMergedJudgementOf,
} from "../instant-eval-judge-route-merge.rules.ts";
import { instantEvalJudgeRoutePlanOf } from "../instant-eval-judge-route.rules.ts";
import {
  findInstantEvalLlmVerdicts,
  instantEvalVerdictSurenessOf,
  isUnsureAnswer,
} from "../instant-eval-judge-sureness.rules.ts";

const table = syntheticRouteTable({ kinds: SYNTHETIC_KINDS });
const POLITE = rating("polite", "how polite, 1 to 5");
const TOPIC = choiceOf("topic", "which topic", ["billing", "shipping", "other"]);

describe("the sureness of a score", () => {
  /** @scenario "A sure score or category answer stays, by its kind's sureness rule" */
  it("is one less the spread over half the range, clamped, and none without a spread", () => {
    const of = (spread?: number, range = { min: 1, max: 5 }) =>
      instantEvalVerdictSurenessOf({
        question: rating("s", "x", range),
        verdict: { questionId: "s", score: 3, ...(spread === undefined ? {} : { spread }) },
        rule: "spread",
      });
    expect(of(0)).toBe(1);
    expect(of(1)).toBeCloseTo(0.5, 10);
    expect(of(2)).toBe(0);
    expect(of(3)).toBe(0);
    expect(of(undefined)).toBe(0);
    expect(of(0.4, { min: 3, max: 3 })).toBe(1);
  });
});

describe("the sureness of a category", () => {
  const of = (probabilities: Record<string, number> | undefined, rule: "margin" | "top") =>
    instantEvalVerdictSurenessOf({
      question: TOPIC,
      verdict: {
        questionId: "topic",
        label: "billing",
        ...(probabilities ? { probabilities } : {}),
      },
      rule,
    });

  /** @scenario "A sure score or category answer stays, by its kind's sureness rule" */
  it("is the top option less the runner-up, over the offered options renormalised", () => {
    expect(of({ billing: 0.6, shipping: 0.3, other: 0.1 }, "margin")).toBeCloseTo(0.3, 10);
    // A stray name is ignored and the offered options are renormalised to sum one.
    expect(of({ billing: 0.4, shipping: 0.2, stray: 0.4 }, "margin")).toBeCloseTo(1 / 3, 10);
    expect(of({ billing: 0.6, shipping: 0.3, other: 0.1 }, "top")).toBeCloseTo(0.6, 10);
    expect(of(undefined, "margin")).toBe(0);
    expect(of({ stray: 1 }, "margin")).toBe(0);
    const prototypeNamed = instantEvalVerdictSurenessOf({
      question: choiceOf("t", "x", ["toString", "other"]),
      verdict: { questionId: "t", label: "other", probabilities: { other: 0.55, toString: 0.45 } },
      rule: "margin",
    });
    expect(prototypeNamed).toBeCloseTo(0.1, 10);
    const missing = instantEvalVerdictSurenessOf({
      question: choiceOf("t", "x", ["toString", "other"]),
      verdict: { questionId: "t", label: "other", probabilities: { other: 0.6 } },
      rule: "margin",
    });
    expect(missing).toBe(1);
  });

  it("escalates anything below the threshold, so an answer with nothing to read always does", () => {
    expect(isUnsureAnswer({ sureness: 0, threshold: 0.01 })).toBe(true);
    expect(isUnsureAnswer({ sureness: 0.19, threshold: 0.2 })).toBe(true);
    expect(isUnsureAnswer({ sureness: 0.2, threshold: 0.2 })).toBe(false);
  });
});

describe("an LLM's answer as a verdict", () => {
  it("gives yes or no as one or zero, a score as itself and a label with all the probability", () => {
    const upset = yesNo("q", "upset");
    expect(findInstantEvalLlmVerdicts({ question: upset, value: { verdict: false } })).toEqual([
      {
        questionId: "q",
        probability: 0,
      },
    ]);
    expect(findInstantEvalLlmVerdicts({ question: POLITE, value: { score: 2.5 } })).toEqual([
      {
        questionId: "polite",
        score: 2.5,
      },
    ]);
    expect(findInstantEvalLlmVerdicts({ question: TOPIC, value: { label: "other" } })).toEqual([
      {
        questionId: "topic",
        label: "other",
        probabilities: { billing: 0, shipping: 0, other: 1 },
      },
    ]);
    expect(findInstantEvalLlmVerdicts({ question: POLITE, value: { label: "x" } })).toEqual([]);
  });
});

describe("the slot of a score or category question", () => {
  const plan = (
    question: typeof POLITE | typeof TOPIC,
    route: Parameters<typeof instantEvalJudgeRoutePlanOf>[0]["route"],
  ) =>
    instantEvalJudgeRoutePlanOf({
      route,
      text: "x",
      questions: [question],
      table,
      kind: question.kind,
    });

  /** @scenario "A score or category question takes its kind's slot, else the kind's default" */
  it("takes the job's slot the kind names, else the kind's default, with the kind's rule", () => {
    const long = plan(POLITE, { job: "search", tokens: 9000 });
    expect(long).toMatchObject({
      kind: "score",
      sureness: "spread",
      slot: "long",
      primary: "llm-b",
    });
    const short = plan(POLITE, { job: "search", tokens: 100 });
    expect(short).toMatchObject({
      slot: "default",
      primary: "decision-a",
      escalateTo: "llm-a",
      threshold: 0.5,
    });
    const paired = plan(TOPIC, { job: "llm_judge", tokens: 100 });
    expect(paired).toMatchObject({
      sureness: "margin",
      slot: "short",
      mode: "instant",
      pairWith: "decision-b",
    });
  });

  /** @scenario "A score or category question takes its kind's slot, else the kind's default" */
  it("uses the length bucket for an arithmetic call when the kind routes no arithmetic slot", () => {
    const counted = rating("count", "how many of the 3 questions were answered", {
      min: 0,
      max: 3,
    });
    const byBucket = syntheticRouteTable({
      kinds: {
        score: {
          sureness: "spread",
          default: { instant: { primary: "decision-a" } },
          routes: { search: { short: { instant: { primary: "decision-b" } } } },
        },
      },
    });
    const p = instantEvalJudgeRoutePlanOf({
      route: { job: "search", tokens: 100, arithmetic: true },
      text: "x",
      questions: [counted],
      table: byBucket,
      kind: "score",
    });
    expect(p).toMatchObject({ arithmetic: true, slot: "short", primary: "decision-b" });
  });
});

describe("a call with questions of several kinds", () => {
  /** @scenario "A kind the table does not route takes today's classifier call" */
  it("groups by kind only when every question can be routed", () => {
    const upset = yesNo("q", "upset");
    const bare = syntheticRouteTable();
    expect(instantEvalJudgeKindGroupsOf({ questions: [POLITE, upset], table: bare })).toEqual([]);
    expect(instantEvalJudgeKindGroupsOf({ questions: [upset], table: bare })).toEqual([
      { kind: "boolean", questions: [upset] },
    ]);
    const both = instantEvalJudgeKindGroupsOf({ questions: [POLITE, upset, TOPIC], table });
    expect(both.map((group) => group.kind)).toEqual(["boolean", "score", "category"]);
  });

  /** @scenario "Questions of several kinds in one call are routed per kind and merged in order" */
  it("shares a first send only between decision-model plans that send the same thing", () => {
    const upset = yesNo("q", "upset");
    const planOf = (kind: "boolean" | "score", mode: "balanced" | "accurate") =>
      instantEvalJudgeRoutePlanOf({
        route: { job: "llm_judge", tokens: 500, mode },
        text: "x",
        questions: [kind === "boolean" ? upset : POLITE],
        table,
        kind,
      });
    const decisions = [planOf("boolean", "balanced"), planOf("score", "balanced")];
    expect(instantEvalJudgeFirstSendLeadsOf({ plans: decisions, table })).toEqual([0, 0]);
    const viewed = [decisions[0]!, { ...decisions[1]!, inputView: "text" as const }];
    expect(instantEvalJudgeFirstSendLeadsOf({ plans: viewed, table })).toEqual([0, 1]);
    // An LLM primary asks per question, so even the same LLM never shares a send.
    const llm = planOf("boolean", "accurate");
    expect(instantEvalJudgeFirstSendLeadsOf({ plans: [llm, llm], table })).toEqual([0, 1]);
  });

  /** @scenario "Questions of several kinds in one call are routed per kind and merged in order" */
  it("merges the parts in the order asked, summing cost, and skips only when nothing answered", () => {
    const routing = (backend: string, flags: string[] = []) => ({
      answeredBy: { [backend]: 1 },
      escalated: 1,
      mode: "balanced" as const,
      slot: "short",
      inputView: "full" as const,
      flags,
    });
    const merged = instantEvalMergedJudgementOf({
      questions: [POLITE, TOPIC],
      parts: [
        {
          kind: "category",
          judgement: {
            verdicts: [{ questionId: "topic", label: "other" }],
            inputTokens: 10,
            isTextTruncated: false,
            costNanoUsd: 5,
            limiterWaitMs: 7,
            routing: routing("llm-b", ["escalation_failed"]),
          },
        },
        {
          kind: "score",
          judgement: {
            verdicts: [{ questionId: "polite", score: 3 }],
            inputTokens: 20,
            isTextTruncated: true,
            costNanoUsd: 2,
            limiterWaitMs: 3,
          },
        },
      ],
    });
    expect(merged).toEqual({
      verdicts: [
        { questionId: "polite", score: 3 },
        { questionId: "topic", label: "other" },
      ],
      inputTokens: 30,
      isTextTruncated: true,
      limiterWaitMs: 7,
      costNanoUsd: 7,
      routing: { ...routing("llm-b"), flags: ["category:escalation_failed"] },
    });
    const skipped = instantEvalMergedJudgementOf({
      questions: [POLITE],
      parts: [
        {
          kind: "score",
          judgement: {
            verdicts: [],
            skippedReason: "classifier_rate_limited",
            inputTokens: 0,
            isTextTruncated: false,
          },
        },
      ],
    });
    expect(skipped.skippedReason).toBe("classifier_rate_limited");
  });
});

describe("the boot check over score and category routes", () => {
  /** @scenario "A route table that cannot bill or call a backend refuses to boot" */
  it("names a backend only a kind's route reaches when it has no price", () => {
    const kindOnly = syntheticRouteTable({
      backends: { "llm-c": { kind: "anthropic_messages", model: "llm-model-c" } },
      kinds: {
        score: {
          sureness: "spread",
          default: { instant: { primary: "decision-a" }, accurate: { primary: "llm-c" } },
        },
      },
    });
    const issues = instantEvalJudgeRouteBootIssues({
      table: kindOnly,
      pricing: {
        version: "t",
        backends: {
          "decision-a": { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 0 },
          "decision-b": { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 0 },
          "llm-a": { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 0 },
          "llm-b": { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 0 },
        },
      },
    });
    expect(issues).toEqual(["backend llm-c: no price in the route pricing"]);
  });
});
