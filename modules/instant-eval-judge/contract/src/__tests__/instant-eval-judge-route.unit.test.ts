import { ConfigParseError, parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
  INSTANT_EVAL_JUDGE_JOBS,
  instantEvalJudgeRouteTableSchema,
} from "../instant-eval-judge-route.ts";
import { instantEvalJudgeConfig } from "../instant-eval-judge.config.ts";
import {
  instantEvalCostUsd,
  instantEvalSpentCostUsd,
  instantEvalSpentPriceUsd,
} from "../instant-eval-pricing.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [{ name: "instant-eval-judge", config: instantEvalJudgeConfig }],
    environment,
  })["instant-eval-judge"];

const slot = (entry: Record<string, unknown>) => ({ instant: entry });

function tableWith(overrides: Record<string, unknown> = {}) {
  const routes = Object.fromEntries(
    INSTANT_EVAL_JUDGE_JOBS.map((job) => [
      job,
      { all: slot({ primary: "jev" }), arithmetic: slot({ primary: "jev" }) },
    ]),
  );
  return {
    version: 1,
    defaultMode: { search: "balanced", llm_judge: "balanced", scenario_judge: "balanced" },
    buckets: [{ name: "all", maxTokens: null }],
    arithmetic: {
      maxTokens: 0,
      source: { search: "regex", llm_judge: "regex", scenario_judge: "regex" },
    },
    backends: {
      jev: { kind: "jev" },
      "llm-a": { kind: "anthropic_messages", model: "llm-model-a" },
    },
    routes,
    ...overrides,
  };
}

describe("judge route table", () => {
  describe("given the table the repository ships", () => {
    /** @scenario "The public default table sends every slot to the hosted classifier" */
    it("names the hosted classifier alone in every slot and mode", () => {
      const table = INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE;
      expect(Object.keys(table.backends)).toEqual(["jev"]);
      for (const job of INSTANT_EVAL_JUDGE_JOBS) {
        for (const routeSlot of Object.values(table.routes[job])) {
          expect(routeSlot).toEqual({ instant: { primary: "jev" } });
        }
      }
      expect(table.inputViews).toEqual({
        default: "full",
        byCategory: {},
        allowedKinds: { text: ["decisions"], tools: [] },
      });
    });
  });

  describe("given a table that cannot route", () => {
    /** @scenario "The route table refuses a slot without an instant entry" */
    it("refuses a slot with no instant entry", () => {
      const table = tableWith();
      (table.routes as Record<string, Record<string, unknown>>).search!.all = {
        balanced: { primary: "jev" },
      };
      expect(instantEvalJudgeRouteTableSchema.validate(table)).toBe(false);
    });

    /** @scenario "The route table refuses a slot without an instant entry" */
    it("refuses an escalation without a threshold, naming the slot", () => {
      const table = tableWith();
      (table.routes as Record<string, Record<string, unknown>>).llm_judge!.all = {
        instant: { primary: "jev", escalateTo: "llm-a" },
      };
      const parsed = instantEvalJudgeRouteTableSchema.safeParse(table);
      expect(parsed.success).toBe(false);
      expect(JSON.stringify(parsed.error?.issues)).toContain("llm_judge / all / instant");
    });

    it("refuses an unknown backend and a missing slot", () => {
      expect(
        instantEvalJudgeRouteTableSchema.validate(
          tableWith({
            backends: { jev: { kind: "jev" } },
            buckets: [{ name: "x", maxTokens: null }],
          }),
        ),
      ).toBe(false);
    });

    /** @scenario "A decision-model backend names its model in the table" */
    it("refuses a Decisions backend with no model, naming it", () => {
      const parsed = instantEvalJudgeRouteTableSchema.safeParse(
        tableWith({ backends: { jev: { kind: "jev" }, hosted: { kind: "decisions" } } }),
      );
      expect(parsed.success).toBe(false);
      expect(JSON.stringify(parsed.error?.issues)).toContain("backend hosted");
    });

    /** @scenario "A decision-model backend names its model in the table" */
    it("refuses an LLM backend with no model", () => {
      const parsed = instantEvalJudgeRouteTableSchema.safeParse(
        tableWith({ backends: { jev: { kind: "jev" }, llm: { kind: "openai_responses" } } }),
      );
      expect(JSON.stringify(parsed.error?.issues)).toContain("backend llm");
    });

    /** @scenario "The route table refuses a slot without an instant entry" */
    it.each([
      [
        "unsorted bounds",
        [
          { name: "a", maxTokens: 500 },
          { name: "b", maxTokens: 100 },
          { name: "c", maxTokens: null },
        ],
        "bucket b: maxTokens must be above",
      ],
      [
        "a repeated name",
        [
          { name: "a", maxTokens: 100 },
          { name: "a", maxTokens: null },
        ],
        "bucket names must be unique",
      ],
      [
        "an open bucket before the last",
        [
          { name: "a", maxTokens: null },
          { name: "b", maxTokens: null },
        ],
        "bucket a: only the last bucket may be open",
      ],
    ])("refuses buckets with %s", (_label, buckets, message) => {
      const routes = Object.fromEntries(
        INSTANT_EVAL_JUDGE_JOBS.map((job) => [
          job,
          Object.fromEntries(
            [...buckets.map((bucket) => bucket.name), "arithmetic"].map((key) => [
              key,
              slot({ primary: "jev" }),
            ]),
          ),
        ]),
      );
      const parsed = instantEvalJudgeRouteTableSchema.safeParse(tableWith({ buckets, routes }));
      expect(JSON.stringify(parsed.error?.issues)).toContain(message);
    });

    /** @scenario "A pair names decision models only" */
    it("refuses an LLM backend as a pair member or a pair member's fallback", () => {
      const backends = {
        jev: { kind: "jev", fallbacks: ["llm-a"] },
        "llm-a": { kind: "anthropic_messages", model: "llm-model-a" },
      };
      const routes = (entry: Record<string, unknown>) =>
        Object.fromEntries(
          INSTANT_EVAL_JUDGE_JOBS.map((job) => [
            job,
            { all: slot(entry), arithmetic: slot(entry) },
          ]),
        );
      for (const entry of [
        { primary: "jev", pairWith: "llm-a" },
        { primary: "jev", pairWith: "jev" },
      ]) {
        const parsed = instantEvalJudgeRouteTableSchema.safeParse(
          tableWith({ backends, routes: routes(entry) }),
        );
        expect(JSON.stringify(parsed.error?.issues)).toContain("may not be an LLM backend");
      }
    });

    it("refuses a backend that lists itself as a fallback", () => {
      const parsed = instantEvalJudgeRouteTableSchema.safeParse(
        tableWith({ backends: { jev: { kind: "jev", fallbacks: ["jev"] } } }),
      );
      expect(JSON.stringify(parsed.error?.issues)).toContain("backend jev: lists itself");
    });

    it("refuses an instant entry on a switched-off backend", () => {
      const table = tableWith({
        backends: {
          jev: { kind: "jev", enabled: false },
          "llm-a": { kind: "anthropic_messages", model: "llm-model-a" },
        },
      });
      expect(instantEvalJudgeRouteTableSchema.validate(table)).toBe(false);
    });
  });

  describe("given the deployment sets the route and price variables", () => {
    it("reads a valid table and prices", () => {
      const config = read({
        INSTANT_EVAL_JUDGE_ROUTES: JSON.stringify(tableWith()),
        INSTANT_EVAL_JUDGE_PRICING: JSON.stringify({
          version: "v1",
          backends: { jev: { usdPerMillionInputTokens: 1 } },
        }),
      });
      expect(config.judgeRoutes?.backends["llm-a"]?.timeoutMs).toBe(30_000);
      expect(config.judgeRoutePricing?.backends.jev?.usdPerMillionOutputTokens).toBe(0);
    });

    it("reads neither when unset", () => {
      expect(read({}).judgeRoutes).toBeUndefined();
      expect(read({}).judgeRoutePricing).toBeUndefined();
    });

    /** @scenario "The route table refuses a slot without an instant entry" */
    it("refuses to boot on a table that is not JSON or cannot route", () => {
      expect(() => read({ INSTANT_EVAL_JUDGE_ROUTES: "{" })).toThrow(ConfigParseError);
      expect(() =>
        read({ INSTANT_EVAL_JUDGE_ROUTES: JSON.stringify(tableWith({ buckets: [] })) }),
      ).toThrow(ConfigParseError);
    });
  });
});

describe("spent cost", () => {
  /** @scenario "A page event without a routed cost still reads and prices from tokens" */
  it("prices the input tokens when no routed cost was recorded", () => {
    expect(instantEvalSpentCostUsd({ inputTokens: 1_000_000, costNanoUsd: 0 })).toBe(
      instantEvalCostUsd({ inputTokens: 1_000_000 }),
    );
  });

  /** @scenario "A routed judgement is priced from the summed cost of every call" */
  /** @scenario "A routed judgement is priced from its summed cost, not its tokens" */
  it("takes the routed cost when one was recorded, and prices it at the markup", () => {
    const spent = { inputTokens: 1_000_000, costNanoUsd: 3_000_000, routedInputTokens: 1_000_000 };

    expect(instantEvalSpentCostUsd(spent)).toBe(0.003);
    // $0.003 at the published 1.3 markup.
    expect(instantEvalSpentPriceUsd(spent)).toBe(0.0039);
  });

  /** @scenario "Routed and unrouted tokens are billed separately" */
  it("adds the unrouted tokens of a mixed run at the published rate", () => {
    const costUsd = instantEvalSpentCostUsd({
      inputTokens: 1_000_000,
      costNanoUsd: 100_000_000,
      routedInputTokens: 500_000,
    });
    expect(costUsd).toBe(0.121);
  });

  /** @scenario "A routed judgement with a cost of zero is still routed" */
  it("prices routed tokens that cost nothing at zero, not at the published rate", () => {
    const costUsd = instantEvalSpentCostUsd({
      inputTokens: 20_000,
      costNanoUsd: 0,
      routedInputTokens: 20_000,
    });
    expect(costUsd).toBe(0);
  });
});

describe("judge route table, given score and category routes", () => {
  const issuesOf = (kinds: unknown) => {
    const parsed = instantEvalJudgeRouteTableSchema.safeParse(tableWith({ kinds }));
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
  };

  /** @scenario "The public default table sends every slot to the hosted classifier" */
  it("ships no score or category routes, so those kinds keep today's classifier call", () => {
    expect(INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE.kinds).toEqual({});
  });

  /** @scenario "The route table refuses a slot without an instant entry" */
  it("accepts a kind's default and job slots, and refuses an unknown slot key or rule", () => {
    const score = {
      sureness: "spread",
      default: {
        instant: { primary: "jev" },
        balanced: { primary: "jev", escalateTo: "llm-a", threshold: 0.5 },
      },
      routes: { search: { all: { instant: { primary: "jev" } } } },
    };
    expect(issuesOf({ score })).toEqual([]);
    expect(
      issuesOf({
        score: { ...score, routes: { search: { huge: { instant: { primary: "jev" } } } } },
      }),
    ).toEqual(["score / search / huge: not a bucket or the arithmetic slot"]);
    expect(issuesOf({ category: { ...score, sureness: "spread" } }).length).toBeGreaterThan(0);
    expect(issuesOf({ category: { ...score, sureness: "top" } })).toEqual([]);
    // A misspelt kind or job is refused, never dropped.
    expect(issuesOf({ scores: score }).length).toBeGreaterThan(0);
    expect(issuesOf({ score: { ...score, routes: { serch: {} } } }).length).toBeGreaterThan(0);
  });

  /** @scenario "The route table refuses a slot without an instant entry" */
  it("checks a kind's slots as it checks yes-or-no ones", () => {
    expect(
      issuesOf({
        score: {
          sureness: "spread",
          default: { instant: { primary: "jev", escalateTo: "llm-a" } },
        },
      }),
    ).toEqual(["score / default / instant: escalateTo needs a threshold"]);
    expect(
      issuesOf({
        category: {
          sureness: "margin",
          default: { instant: { primary: "jev", pairWith: "llm-a" } },
        },
      }),
    ).toEqual(["category / default / instant: a pair or its fallbacks may not be an LLM backend"]);
  });
});
