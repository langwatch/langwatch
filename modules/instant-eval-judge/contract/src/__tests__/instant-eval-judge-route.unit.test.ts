import { ConfigParseError, parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
  INSTANT_EVAL_JUDGE_JOBS,
  instantEvalJudgeRouteTableSchema,
} from "../instant-eval-judge-route.ts";
import { instantEvalJudgeConfig } from "../instant-eval-judge.config.ts";
import { instantEvalCostUsd, instantEvalSpentCostUsd } from "../instant-eval-pricing.ts";

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
          markup: 1.3,
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
  it("takes the routed cost when one was recorded", () => {
    expect(instantEvalSpentCostUsd({ inputTokens: 1_000_000, costNanoUsd: 2_500 })).toBe(0.0000025);
  });
});
