import {
  INSTANT_EVAL_PRICING,
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING,
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
  INSTANT_EVAL_JUDGE_JOBS,
  INSTANT_EVAL_JUDGE_MODES,
  type InstantEvalJudgeRouteRequest,
  instantEvalTextBudget,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import {
  gatedRouteTable,
  syntheticRouteTable,
  yesNo,
} from "../../__tests__/support/instant-eval-judge-route.test-fakes.ts";
import { prepareInstantEvalText } from "../instant-eval-classifier-text.rules.ts";
import {
  instantEvalJudgeQueryHoldPricingOf,
  instantEvalJudgeRouteBootIssues,
} from "../instant-eval-judge-route-boot.rules.ts";
import {
  instantEvalJudgeCallCostOf,
  instantEvalJudgeSendWorstCaseNanoUsd,
  instantEvalJudgeSpendAfterCall,
} from "../instant-eval-judge-route-cost.rules.ts";
import { instantEvalJudgeFirstSendLeadsOf } from "../instant-eval-judge-route-merge.rules.ts";
import { instantEvalJudgeRoutePlanOf } from "../instant-eval-judge-route.rules.ts";
import {
  instantEvalVerdictSurenessOf,
  isUnsureAnswer,
} from "../instant-eval-judge-sureness.rules.ts";
import { instantEvalLlmContentBudgetTokensOf } from "../instant-eval-llm-tool-call-wire.rules.ts";

const table = syntheticRouteTable();
const UPSET = yesNo("q", "is the user upset");

function plan(route: InstantEvalJudgeRouteRequest, question = UPSET, text = "x") {
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

describe("a judgement's spend after one more call", () => {
  const pricing = {
    version: "test",
    backends: { llm: { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 5 } },
  };
  const spend = { inputTokens: 1000, costNanoUsd: 7 };

  /** @scenario "A routed judgement is priced from the summed cost of every call" */
  it("adds a priced call's tokens and cost", () => {
    expect(
      instantEvalJudgeSpendAfterCall({
        spend,
        backend: "llm",
        inputTokens: 100,
        outputTokens: 10,
        pricing,
      }),
    ).toEqual({ spend: { inputTokens: 1100, costNanoUsd: 150_007 }, isUnpriced: false });
  });

  /** @scenario "Each call's tokens and cost are added to its judgement's spend" */
  it("adds an unpriced call's tokens and no cost, and says it had no price", () => {
    expect(
      instantEvalJudgeSpendAfterCall({
        spend,
        backend: "other",
        inputTokens: 100,
        outputTokens: 10,
        pricing,
      }),
    ).toEqual({ spend: { inputTokens: 1100, costNanoUsd: 7 }, isUnpriced: true });
  });

  /** @scenario "Each call's tokens and cost are added to its judgement's spend" */
  it("changes nothing for a call that billed no tokens, priced or not", () => {
    for (const backend of ["llm", "other"]) {
      expect(
        instantEvalJudgeSpendAfterCall({
          spend,
          backend,
          inputTokens: 0,
          outputTokens: 0,
          pricing,
        }),
      ).toEqual({ spend, isUnpriced: false });
    }
  });

  /** @scenario "Each call's tokens and cost are added to its judgement's spend" */
  it("counts a call that billed output tokens alone", () => {
    expect(
      instantEvalJudgeSpendAfterCall({
        spend,
        backend: "llm",
        inputTokens: 0,
        outputTokens: 10,
        pricing,
      }),
    ).toEqual({ spend: { inputTokens: 1000, costNanoUsd: 50_007 }, isUnpriced: false });
  });
});

describe("a send's worst case", () => {
  const ONE = yesNo("q", "is it");
  const TWO = yesNo("r", "is it not");
  const worstTable = syntheticRouteTable({
    backends: {
      dec: { kind: "decisions", model: "decision-model" },
      jv: { kind: "jev" },
      llm: { kind: "openai_responses", model: "llm-model" },
      llmHigh: { kind: "openai_responses", model: "llm-model", reasoningEffort: "high" },
      llmCapped: {
        kind: "openai_responses",
        model: "llm-model",
        reasoningEffort: "high",
        maxOutputTokens: 1_100,
      },
      ant: { kind: "anthropic_messages", model: "llm-model" },
      gem: { kind: "gemini_generate_content", model: "llm-model" },
    },
  });
  const llmPrice = { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 5 };
  const pricing = {
    version: "test",
    backends: {
      dec: { usdPerMillionInputTokens: 0.1, usdPerMillionOutputTokens: 0 },
      jv: { usdPerMillionInputTokens: 0.05, usdPerMillionOutputTokens: 0 },
      llm: llmPrice,
      llmHigh: llmPrice,
      llmCapped: llmPrice,
      ant: llmPrice,
      gem: llmPrice,
    },
  };
  const worst = ({
    backend,
    text = "abc",
    questions = [ONE],
    prices = pricing,
  }: {
    backend: string;
    text?: string;
    questions?: (typeof ONE)[];
    prices?: typeof pricing | Record<string, unknown>;
  }) =>
    instantEvalJudgeSendWorstCaseNanoUsd({
      backend,
      table: worstTable,
      pricing: prices as typeof pricing,
      job: "search",
      text,
      questions,
    });

  /** @scenario "A send's worst case bounds what it can bill" */
  it("counts Jev once for all questions and Decisions once per question, a byte a token", () => {
    // Jev: 3 text bytes + 107 bytes of both questions + 1,024 slack, at 0.05 per million.
    expect(worst({ backend: "jv", questions: [ONE, TWO] })).toBe(56_700);
    // Decisions: (3 + 52 + 1,024) and (3 + 56 + 1,024) tokens at 0.1 per million.
    expect(worst({ backend: "dec", questions: [ONE, TWO] })).toBe(216_200);
  });

  /** @scenario "A send's worst case bounds what it can bill" */
  it("reads UTF-8 bytes, not characters", () => {
    expect(worst({ backend: "dec", text: "é" }) - worst({ backend: "dec", text: "e" })).toBe(100);
  });

  /** @scenario "A send's worst case bounds what it can bill" */
  it("takes the dearer long-context rate even for a short text, and a decision model's output allowance", () => {
    const prices = {
      version: "test",
      backends: {
        dec: {
          usdPerMillionInputTokens: 0.1,
          usdPerMillionOutputTokens: 1,
          longContext: {
            aboveInputTokens: 100_000,
            usdPerMillionInputTokens: 0.3,
            usdPerMillionOutputTokens: 0,
          },
        },
      },
    };
    // 1,079 tokens at the long 0.3, plus 256 output tokens at the base 1.0.
    expect(worst({ backend: "dec", prices })).toBe(323_700 + 256_000);
  });

  /** @scenario "A send's worst case bounds what it can bill" */
  it("adds an LLM's output cap per question, the reasoning cap where an effort is set", () => {
    const plain = worst({ backend: "llm" });
    // 32,000 against 8,000 output tokens at 5 per million.
    expect(worst({ backend: "llmHigh" }) - plain).toBe(24_000 * 5 * 1_000);
    expect(worst({ backend: "ant" })).toBe(plain);
    expect(plain).toBeGreaterThan(8_000 * 5 * 1_000 + 1_024 * 1_000);
    const both = worst({ backend: "llm", questions: [ONE, TWO] });
    expect(both).toBeGreaterThan(2 * plain);
    expect(both).toBeLessThan(2 * plain + 100 * 1_000);
  });

  /** @scenario "A send's worst case bounds what it can bill" */
  it("counts a Gemini call as an LLM call that keeps a longer text", () => {
    expect(worst({ backend: "gem" })).toBe(worst({ backend: "ant" }));
    const long = `user: ${"the parcel came late again and nobody answered. ".repeat(42_000)}`;
    const geminiFit = prepareInstantEvalText({
      text: long,
      budgetTokens: instantEvalLlmContentBudgetTokensOf("gemini_generate_content"),
    }).text;
    expect(worst({ backend: "gem", text: long })).toBe(worst({ backend: "gem", text: geminiFit }));
    expect(worst({ backend: "gem", text: long })).toBeGreaterThan(
      worst({ backend: "ant", text: long }),
    );
  });

  /** @scenario "A send's worst case bounds what it can bill" */
  it("adds a backend's own output cap where the table sets one", () => {
    // 1,100 against 8,000 output tokens at 5 per million.
    expect(worst({ backend: "llm" }) - worst({ backend: "llmCapped" })).toBe(6_900 * 5 * 1_000);
  });

  /** @scenario "A send's worst case bounds what it can bill" */
  it("prices a long text as its channel fits it, never the bytes it cuts", () => {
    const long = `user: ${"the parcel came late again and nobody answered. ".repeat(42_000)}`;
    const llmFit = prepareInstantEvalText({
      text: long,
      budgetTokens: instantEvalLlmContentBudgetTokensOf("openai_responses"),
    }).text;
    const decisionFit = prepareInstantEvalText({
      text: long,
      budgetTokens: instantEvalTextBudget({ questions: [ONE] }),
    }).text;
    expect(llmFit.length).toBeLessThan(long.length / 4);
    expect(decisionFit.length).toBeLessThan(llmFit.length);
    expect(worst({ backend: "llm", text: long })).toBe(worst({ backend: "llm", text: llmFit }));
    expect(worst({ backend: "dec", text: long })).toBe(
      worst({ backend: "dec", text: decisionFit }),
    );
    expect(worst({ backend: "jv", text: long })).toBe(worst({ backend: "jv", text: decisionFit }));
    // About 2 MB unfitted would hold 0.20 USD on Decisions; fitted it holds under a cent.
    expect(worst({ backend: "dec", text: long })).toBeLessThan(10_000_000);
  });

  /** @scenario "A send's worst case bounds what it can bill" */
  it("is infinite for a backend with no price or not in the table", () => {
    expect(worst({ backend: "jv", prices: { version: "test", backends: {} } })).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(worst({ backend: "missing" })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("the query hold rate", () => {
  const priced = (usdPerMillionInputTokens: number) => ({
    usdPerMillionInputTokens,
    usdPerMillionOutputTokens: 0,
  });

  /** @scenario "A judged query is held at the dearest rate a route can reach" */
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

  /** @scenario "A scenario route's backends never raise a judged query's hold" */
  it("leaves out a backend only scenario judging can reach, and keeps a gate's", () => {
    const pricing = {
      version: "t",
      backends: {
        "gate-a": priced(3),
        "decision-a": priced(0.1),
        "llm-a": priced(9),
        "llm-b": priced(2),
      },
    };
    const scenarioOnLlmA = gatedRouteTable({ scenarioPrimary: "llm-a" });
    const hold = instantEvalJudgeQueryHoldPricingOf({ table: scenarioOnLlmA, pricing });
    expect(hold.usdPerMillionInputTokens).toBe(3);
    // The boot check still asks a price for it: a scenario judgement is billed too.
    const { "llm-a": _dear, ...withoutScenarioPrice } = pricing.backends;
    expect(
      instantEvalJudgeRouteBootIssues({
        table: scenarioOnLlmA,
        pricing: { version: "t", backends: withoutScenarioPrice },
      }),
    ).toEqual(["backend llm-a: no price in the route pricing"]);
  });

  /** @scenario "A judged query is held at the dearest rate a route can reach" */
  it("holds at the classifier's published rate under the public table", () => {
    const hold = instantEvalJudgeQueryHoldPricingOf({
      table: INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
      pricing: INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING,
    });
    expect(hold).toEqual(INSTANT_EVAL_PRICING);
  });
});

describe("a gated entry's plan", () => {
  const gated = gatedRouteTable();
  const planOn = (mode?: "instant") =>
    instantEvalJudgeRoutePlanOf({
      route: { job: "llm_judge", ...(mode ? { mode } : {}) },
      text: "x",
      questions: [UPSET],
      table: gated,
    });

  /** @scenario "A gate sends an easy case to the primary alone and the rest to the escalation alone" */
  it("carries the gate with the primary and the escalation, and no threshold", () => {
    expect(planOn()).toMatchObject({
      mode: "balanced",
      primary: "decision-a",
      escalateTo: "llm-b",
      gate: { backend: "gate-a", question: "difficulty_v1", easyBelow: 1.5 },
    });
    expect(planOn().threshold).toBeUndefined();
    expect(planOn("instant").gate).toBeUndefined();
  });

  /** @scenario "A gate sends an easy case to the primary alone and the rest to the escalation alone" */
  it("never shares its first send with another plan, even one asking the same primary", () => {
    const { gate: _gate, ...ungated } = planOn();
    const leads = (plans: Parameters<typeof instantEvalJudgeFirstSendLeadsOf>[0]["plans"]) =>
      instantEvalJudgeFirstSendLeadsOf({ plans, table: gated });
    expect(leads([ungated, ungated])).toEqual([0, 0]);
    expect(leads([planOn(), ungated])).toEqual([0, 1]);
    expect(leads([ungated, planOn()])).toEqual([0, 1]);
    expect(leads([planOn(), planOn()])).toEqual([0, 1]);
  });

  /** @scenario "A route table that cannot bill or call a backend refuses to boot" */
  it("needs a price and a key for its gate backend too", () => {
    const price = { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 0 };
    const issues = instantEvalJudgeRouteBootIssues({
      table: gated,
      pricing: { version: "t", backends: { "decision-a": price, "llm-b": price } },
      isHeld: (kind) => kind !== "jev",
    });
    expect(issues).toEqual([
      "backend gate-a: no price in the route pricing",
      "backend gate-a: no jev key or channel on this install",
    ]);
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
