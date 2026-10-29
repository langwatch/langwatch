import {
  INSTANT_EVAL_PRICING,
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING,
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
  INSTANT_EVAL_JUDGE_JOBS,
  INSTANT_EVAL_JUDGE_MODES,
  type InstantEvalJudgeRoute,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import {
  syntheticRouteTable,
  yesNo,
} from "../../__tests__/support/instant-eval-judge-route.test-fakes.ts";
import {
  instantEvalJudgeQueryHoldPricingOf,
  instantEvalJudgeRouteBootIssues,
} from "../instant-eval-judge-route-boot.rules.ts";
import { instantEvalJudgeCallCostOf } from "../instant-eval-judge-route-cost.rules.ts";
import { instantEvalJudgeRoutePlanOf } from "../instant-eval-judge-route.rules.ts";
import {
  instantEvalVerdictSurenessOf,
  isUnsureAnswer,
} from "../instant-eval-judge-sureness.rules.ts";

const table = syntheticRouteTable();
const UPSET = yesNo("q", "is the user upset");

function plan(route: InstantEvalJudgeRoute, question = UPSET, text = "x") {
  return instantEvalJudgeRoutePlanOf({ route, text, questions: [question], table });
}

describe("the unsure rule", () => {
  const isUnsureVerdict = ({
    probability,
    threshold,
  }: {
    probability?: number;
    threshold: number;
  }) =>
    isUnsureAnswer({
      sureness: instantEvalVerdictSurenessOf({
        question: UPSET,
        verdict: { questionId: UPSET.id, ...(probability === undefined ? {} : { probability }) },
        rule: undefined,
      }),
      threshold,
    });

  /** @scenario "An unsure decision-model answer escalates to the LLM leg" */
  it("is |2p - 1| below the threshold, and no probability is unsure", () => {
    expect(isUnsureVerdict({ probability: 0.15, threshold: 0.7 })).toBe(false);
    expect(isUnsureVerdict({ probability: 0.85, threshold: 0.7 })).toBe(false);
    for (const p of [0.16, 0.5, 0.84]) {
      expect(isUnsureVerdict({ probability: p, threshold: 0.7 })).toBe(true);
    }
    expect(isUnsureVerdict({ probability: 0, threshold: 0.7 })).toBe(false);
    expect(isUnsureVerdict({ probability: 1, threshold: 0.7 })).toBe(false);
    expect(isUnsureVerdict({ threshold: 0.7 })).toBe(true);
  });
});

describe("the route plan", () => {
  /** @scenario "A slot is picked by job, length bucket and arithmetic flag" */
  it.each([
    [1, "short"],
    [1500, "short"],
    [1501, "medium"],
    [6000, "medium"],
    [6001, "long"],
  ])("puts %i tokens in the %s bucket", (tokens, bucket) => {
    expect(plan({ job: "search", tokens }).bucket).toBe(bucket);
  });

  it("plans the job's default mode", () => {
    const p = plan({ job: "search", tokens: 900 });
    expect(p).toMatchObject({ mode: "balanced", primary: "decision-a", escalateTo: "llm-b" });
    expect(p.threshold).toBe(0.6);
  });

  /** @scenario "A slot is picked by job, length bucket and arithmetic flag" */
  it("lets the caller's flag beat the regex where the job's source allows it", () => {
    const counted = yesNo("q", "how many refunds over 20 dollars");
    expect(plan({ job: "search", arithmetic: false }, counted).slot).toBe("short");
    expect(plan({ job: "search", arithmetic: true }).slot).toBe("arithmetic");
    expect(plan({ job: "search" }, yesNo("q", "what is the total price")).slot).toBe("arithmetic");
  });

  it("reads the regex alone for a regex-sourced job, and the request alone for a request one", () => {
    const refund = yesNo("q", "The refund amount is correct");
    expect(plan({ job: "llm_judge", arithmetic: false }, refund).slot).toBe("arithmetic");
    expect(plan({ job: "scenario_judge" }, refund).slot).toBe("short");
  });

  it("keeps a long arithmetic input in its length bucket", () => {
    const p = plan({ job: "search", tokens: 20_000 }, yesNo("q", "total price"));
    expect(p).toMatchObject({ slot: "long", arithmetic: true });
  });

  /** @scenario "A mode with no usable entry falls back to the next cheaper mode" */
  it("falls back from accurate to balanced, and to instant when balanced is missing", () => {
    expect(plan({ job: "llm_judge", tokens: 20_000, mode: "accurate" })).toMatchObject({
      modeRequested: "accurate",
      mode: "balanced",
      escalateTo: "llm-a",
    });
    expect(plan({ job: "search", tokens: 5000, mode: "accurate" }).mode).toBe("instant");
  });

  /** @scenario "A mode with no usable entry falls back to the next cheaper mode" */
  it("skips an entry whose backend is switched off", () => {
    const off = syntheticRouteTable({
      backends: { "llm-b": { kind: "openai_responses", model: "llm-model-b", enabled: false } },
    });
    const p = instantEvalJudgeRoutePlanOf({
      route: { job: "search", tokens: 900, mode: "accurate" },
      text: "x",
      questions: [UPSET],
      table: off,
    });
    expect(p).toMatchObject({ mode: "instant", primary: "decision-a", pairWith: "decision-b" });
  });

  it("keeps only enabled fallbacks", () => {
    expect(plan({ job: "search", tokens: 900, mode: "instant" }).fallbacks).toEqual({
      "decision-a": ["decision-b"],
      "decision-b": [],
    });
  });

  /** @scenario "The input view follows the question category from config" */
  it("judges the text view for a category the table maps to it, and a call's own view wins", () => {
    const route = {
      job: "search",
      questionCategory: "sentiment",
      views: { text: "user: hi" },
    } as const;
    expect(plan(route, UPSET, "full trace")).toMatchObject({ inputView: "text", text: "user: hi" });
    expect(plan({ ...route, inputView: "full" }, UPSET, "full trace").text).toBe("full trace");
    expect(plan({ job: "search", questionCategory: "tool_args" }).inputView).toBe("full");
    expect(plan({ job: "search", questionCategory: "unmapped" }).inputView).toBe("full");
  });

  /** @scenario "The length bucket is measured on the chosen view" */
  it("measures the bucket on the chosen view's tokens", () => {
    const route = {
      job: "search",
      questionCategory: "sentiment",
      views: { text: "short" },
    } as const;
    expect(plan(route, UPSET, "a".repeat(30_000)).bucket).toBe("short");
    expect(plan({ ...route, inputView: "full" }, UPSET, "a".repeat(30_000)).bucket).toBe("long");
  });

  /** @scenario "The text view is judged only by a decision model allowed to read it" */
  it("plans the full view when the text view's slot names a model not allowed to read it", () => {
    const route = {
      job: "search",
      questionCategory: "sentiment",
      views: { text: "user: hi" },
    } as const;
    const paired = plan({ ...route, mode: "instant" }, UPSET, "full trace");
    expect(paired).toMatchObject({
      inputView: "full",
      text: "full trace",
      refusedView: "text",
    });
    const llm = plan({ ...route, mode: "accurate" }, UPSET, "full trace");
    expect(llm).toMatchObject({ inputView: "full", primary: "llm-b", refusedView: "text" });
    const decisions = plan(route, UPSET, "full trace");
    expect(decisions).toMatchObject({ inputView: "text", fullText: "full trace" });
    expect(decisions.refusedView).toBeUndefined();
  });

  /** @scenario "The text view is judged only by a decision model allowed to read it" */
  it("keeps the tools view off until the table lets a backend kind read it", () => {
    const route = {
      job: "search",
      questionCategory: "tool_errors",
      views: { tools: "calls" },
    } as const;
    const off = syntheticRouteTable({
      inputViews: { default: "full", byCategory: { tool_errors: "tools" } },
    });
    const asked = instantEvalJudgeRoutePlanOf({
      route,
      text: "the full trace, with the calls",
      questions: [UPSET],
      table: off,
    });
    expect(asked).toMatchObject({ inputView: "full", refusedView: "tools" });
    const on = syntheticRouteTable({
      inputViews: {
        default: "full",
        byCategory: { tool_errors: "tools" },
        allowedKinds: { text: ["decisions"], tools: ["decisions"] },
      },
    });
    const allowed = instantEvalJudgeRoutePlanOf({
      route,
      text: "the full trace, with the calls",
      questions: [UPSET],
      table: on,
    });
    expect(allowed).toMatchObject({ inputView: "tools", text: "calls" });
  });

  /** @scenario "The tools view is used only when it is shorter than the full trace" */
  it("plans the full trace when the tools rendering is no shorter than it", () => {
    const tools = syntheticRouteTable({
      inputViews: {
        default: "full",
        byCategory: { tool_errors: "tools" },
        allowedKinds: { text: ["decisions"], tools: ["decisions"] },
      },
    });
    const planOf = (rendered: string) =>
      instantEvalJudgeRoutePlanOf({
        route: { job: "search", questionCategory: "tool_errors", views: { tools: rendered } },
        text: "a".repeat(400),
        questions: [UPSET],
        table: tools,
      });
    expect(planOf("a".repeat(400))).toMatchObject({ inputView: "full", longerView: "tools" });
    expect(planOf("a".repeat(100))).toMatchObject({ inputView: "tools", text: "a".repeat(100) });
    expect(planOf("a".repeat(100)).longerView).toBeUndefined();
  });

  /** @scenario "The public default table sends every slot to the hosted classifier" */
  it("maps no category to a partial view unless the table does, so every call judges the full trace", () => {
    const p = instantEvalJudgeRoutePlanOf({
      route: { job: "search", questionCategory: "sentiment", views: { text: "hi", tools: "t" } },
      text: "full trace",
      questions: [UPSET],
      table: INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
    });
    expect(p).toMatchObject({ inputView: "full", text: "full trace" });
  });

  /** @scenario "A text view the caller did not render judges the full text, flagged" */
  it("judges the full text when the text view is missing, and says so", () => {
    const p = plan({ job: "search", inputView: "text" }, UPSET, "full trace");
    expect(p).toMatchObject({ text: "full trace", isViewMissing: true });
  });

  /** @scenario "A text view the caller did not render judges the full text, flagged" */
  it("treats an empty rendering as no view at all", () => {
    const p = plan({ job: "search", inputView: "text", views: { text: " \n" } }, UPSET, "trace");
    expect(p).toMatchObject({ inputView: "text", text: "trace", isViewMissing: true });
  });

  /** @scenario "The public default table sends every slot to the hosted classifier" */
  it("plans the hosted classifier alone in every slot of the shipped table", () => {
    for (const job of INSTANT_EVAL_JUDGE_JOBS) {
      for (const mode of INSTANT_EVAL_JUDGE_MODES) {
        for (const tokens of [10, 50_000]) {
          const p = instantEvalJudgeRoutePlanOf({
            route: { job, mode, tokens, arithmetic: true },
            text: "x",
            questions: [UPSET],
            table: INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
          });
          expect(p).toMatchObject({ primary: "jev", inputView: "full" });
          expect(p.pairWith ?? p.escalateTo).toBeUndefined();
        }
      }
    }
  });
});

describe("the arithmetic rule, on a job that reads it from the question", () => {
  const slotOf = (instructions: string) =>
    plan({ job: "llm_judge" }, yesNo("q", instructions)).slot;

  it("fires on counting words, currency and any digit", () => {
    expect(slotOf("How many items were refunded?")).toBe("arithmetic");
    expect(slotOf("cost over €5")).toBe("arithmetic");
    expect(slotOf("order 7 arrived")).toBe("arithmetic");
    expect(slotOf("was the user polite")).not.toBe("arithmetic");
  });
});

describe("a routed call's cost", () => {
  const pricing = {
    version: "test",
    backends: {
      llm: {
        usdPerMillionInputTokens: 1,
        usdPerMillionOutputTokens: 5,
        longContext: {
          aboveInputTokens: 100,
          usdPerMillionInputTokens: 2,
          usdPerMillionOutputTokens: 10,
        },
      },
    },
  };

  /** @scenario "A routed judgement is priced from the summed cost of every call" */
  it("prices input and output at the backend's rate, and the long rate past its bound", () => {
    const cost = ({
      backend,
      inputTokens,
      outputTokens,
    }: {
      backend: string;
      inputTokens: number;
      outputTokens: number;
    }) => instantEvalJudgeCallCostOf({ backend, inputTokens, outputTokens, pricing });
    expect(cost({ backend: "llm", inputTokens: 100, outputTokens: 10 })).toEqual({
      outcome: "priced",
      costNanoUsd: 150_000,
    });
    expect(cost({ backend: "llm", inputTokens: 101, outputTokens: 0 })).toEqual({
      outcome: "priced",
      costNanoUsd: 202_000,
    });
    expect(cost({ backend: "other", inputTokens: 1, outputTokens: 0 })).toEqual({
      outcome: "unpriced",
    });
  });
});

describe("the query hold rate", () => {
  const priced = (usdPerMillionInputTokens: number) => ({
    usdPerMillionInputTokens,
    usdPerMillionOutputTokens: 0,
  });

  /** @scenario "A routed judgement is priced from the summed cost of every call" */
  it("holds at the dearest input rate a route can reach, skipping switched-off backends", () => {
    const off = syntheticRouteTable({
      backends: { "llm-a": { kind: "anthropic_messages", model: "m", enabled: false } },
    });
    const hold = instantEvalJudgeQueryHoldPricingOf({
      table: off,
      pricing: {
        version: "t",
        backends: {
          "decision-a": priced(0.1),
          "decision-b": priced(0.05),
          "llm-a": priced(9),
          "llm-b": priced(2),
        },
      },
    });
    expect(hold).toEqual({ usdPerMillionInputTokens: 2, markup: INSTANT_EVAL_PRICING.markup });
  });

  /** @scenario "A routed judgement is priced from the summed cost of every call" */
  it("holds at the classifier's published rate under the public table", () => {
    const hold = instantEvalJudgeQueryHoldPricingOf({
      table: INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
      pricing: INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING,
    });
    expect(hold).toEqual(INSTANT_EVAL_PRICING);
  });
});

describe("the boot check", () => {
  const price = { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 0 };

  /** @scenario "A route table that cannot bill or call a backend refuses to boot" */
  it("accepts the public table at the published rate without asking for keys", () => {
    expect(
      instantEvalJudgeRouteBootIssues({
        table: INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
        pricing: INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING,
      }),
    ).toEqual([]);
  });

  /** @scenario "A route table that cannot bill or call a backend refuses to boot" */
  it("names every reachable backend with no price or no key, and skips switched-off ones", () => {
    const off = syntheticRouteTable({
      backends: { "llm-a": { kind: "anthropic_messages", model: "m", enabled: false } },
    });
    const issues = instantEvalJudgeRouteBootIssues({
      table: off,
      pricing: {
        version: "t",
        backends: { "decision-a": price, "decision-b": price },
      },
      isHeld: (kind) => kind !== "openai_responses",
    });
    expect(issues).toEqual([
      "backend llm-b: no price in the route pricing",
      "backend llm-b: no openai_responses key or channel on this install",
    ]);
  });
});
