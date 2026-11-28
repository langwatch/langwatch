import { ConfigParseError, parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_TABLE,
  INSTANT_EVAL_JUDGE_GATE_QUESTIONS,
  INSTANT_EVAL_JUDGE_JOBS,
  instantEvalJudgeEnabledFallbacksOf,
  instantEvalJudgeEntryBackends,
  instantEvalJudgeRouteSlotsOf,
  instantEvalJudgeRouteTableSchema,
  isInstantEvalJudgeEntryEnabled,
  isInstantEvalJudgeLlmBackend,
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

/** A made-up table whose balanced LLM-judge entry is gated; `entry` overrides that entry's keys. */
function gatedTable({
  entry = {},
  backends = {},
}: { entry?: Record<string, unknown>; backends?: Record<string, unknown> } = {}) {
  const table = tableWith({
    backends: {
      jev: { kind: "jev" },
      "gate-a": { kind: "jev", timeoutMs: 500 },
      "decision-a": { kind: "decisions", model: "decision-model-a" },
      "llm-b": { kind: "openai_responses", model: "llm-model-b", reasoningEffort: "high" },
      ...backends,
    },
  });
  (table.routes as Record<string, Record<string, unknown>>).llm_judge!.all = {
    instant: { primary: "jev" },
    balanced: {
      primary: "decision-a",
      escalateTo: "llm-b",
      gate: { backend: "gate-a", question: "difficulty_v1", easyBelow: 1.5 },
      ...entry,
    },
  };
  return table;
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

    /** @scenario "A gate names a hosted classifier backend and an escalation, nothing else" */
    it("accepts a gate between a primary and an escalation, and an effort on an OpenAI backend", () => {
      const parsed = instantEvalJudgeRouteTableSchema.parse(gatedTable());
      expect(parsed.routes.llm_judge.all?.balanced).toEqual({
        primary: "decision-a",
        escalateTo: "llm-b",
        gate: { backend: "gate-a", question: "difficulty_v1", easyBelow: 1.5 },
      });
      expect(parsed.backends["llm-b"]?.reasoningEffort).toBe("high");
      expect(parsed.backends.jev?.reasoningEffort).toBeUndefined();
    });

    /** @scenario "A gate names a hosted classifier backend and an escalation, nothing else" */
    it.each([
      ["a threshold", { threshold: 0.5 }, "a gate takes no threshold and no pair"],
      ["a pair", { pairWith: "jev" }, "a gate takes no threshold and no pair"],
      ["no escalation", { escalateTo: undefined }, "a gate needs an escalateTo"],
      [
        "a gate backend that is not the hosted classifier",
        { gate: { backend: "decision-a", question: "difficulty_v1", easyBelow: 1.5 } },
        "the gate backend decision-a must be a jev backend",
      ],
      [
        "an unknown gate backend",
        { gate: { backend: "nobody", question: "difficulty_v1", easyBelow: 1.5 } },
        "unknown backend nobody",
      ],
    ])("refuses a gated entry with %s, naming the slot", (_what, entry, issue) => {
      const parsed = instantEvalJudgeRouteTableSchema.safeParse(gatedTable({ entry }));
      expect(parsed.success).toBe(false);
      const issues = JSON.stringify(parsed.error?.issues);
      expect(issues).toContain("llm_judge / all / balanced");
      expect(issues).toContain(issue);
    });

    /** @scenario "A gate names a hosted classifier backend and an escalation, nothing else" */
    it("accepts a threshold equal to the question's top level", () => {
      const gate = { backend: "gate-a", question: "difficulty_v1", easyBelow: 4 };
      expect(INSTANT_EVAL_JUDGE_GATE_QUESTIONS.difficulty_v1.levelCount).toBe(5);
      const parsed = instantEvalJudgeRouteTableSchema.parse(gatedTable({ entry: { gate } }));
      expect(parsed.routes.llm_judge.all?.balanced?.gate?.easyBelow).toBe(4);
    });

    /** @scenario "A gate names a hosted classifier backend and an escalation, nothing else" */
    it("refuses an unknown gate question, a threshold outside the levels, and a gate with fallbacks", () => {
      const gate = { backend: "gate-a", question: "difficulty_v1", easyBelow: 1.5 };
      for (const bad of [
        { ...gate, question: "difficulty_v0" },
        { ...gate, easyBelow: 0 },
        { ...gate, easyBelow: 4.0001 },
      ]) {
        const table = gatedTable({ entry: { gate: bad } });
        expect(instantEvalJudgeRouteTableSchema.validate(table)).toBe(false);
      }
      const aboveTop = instantEvalJudgeRouteTableSchema.safeParse(
        gatedTable({ entry: { gate: { ...gate, easyBelow: 4.0001 } } }),
      );
      expect(JSON.stringify(aboveTop.error?.issues)).toContain(
        "the gate's easyBelow must be at most difficulty_v1's top level 4",
      );
      const parsed = instantEvalJudgeRouteTableSchema.safeParse(
        gatedTable({ backends: { "gate-a": { kind: "jev", fallbacks: ["jev"] } } }),
      );
      expect(JSON.stringify(parsed.error?.issues)).toContain(
        "the gate backend gate-a takes no fallbacks",
      );
    });

    /** @scenario "A reasoning effort is sent only when the backend sets one" */
    it.each([
      ["jev", { kind: "jev", reasoningEffort: "high" }],
      ["decisions", { kind: "decisions", model: "decision-model-a", reasoningEffort: "high" }],
      [
        "anthropic_messages",
        { kind: "anthropic_messages", model: "llm-model-a", reasoningEffort: "low" },
      ],
      [
        "gemini_generate_content",
        { kind: "gemini_generate_content", model: "llm-model-c", reasoningEffort: "low" },
      ],
    ])("refuses a reasoning effort on a %s backend, naming it", (kind, backend) => {
      const parsed = instantEvalJudgeRouteTableSchema.safeParse(
        gatedTable({ backends: { extra: backend } }),
      );
      expect(parsed.success).toBe(false);
      expect(JSON.stringify(parsed.error?.issues)).toContain(
        `backend extra: a ${kind} backend takes no reasoningEffort`,
      );
    });

    /** @scenario "A route table holds a Gemini backend to a bare model id and no reasoning effort" */
    it("takes a Gemini backend as an LLM that may escalate", () => {
      const table = gatedTable({
        backends: { "llm-c": { kind: "gemini_generate_content", model: "llm-model-3.8_c" } },
        entry: { escalateTo: "llm-c" },
      });
      const parsed = instantEvalJudgeRouteTableSchema.parse(table);
      expect(isInstantEvalJudgeLlmBackend({ backend: "llm-c", table: parsed })).toBe(true);
      expect(isInstantEvalJudgeLlmBackend({ backend: "decision-a", table: parsed })).toBe(false);
    });

    /** @scenario "A route table holds a Gemini backend to a bare model id and no reasoning effort" */
    it.each([
      ["no model", { kind: "gemini_generate_content" }, "must name its model"],
      [
        "a path in its model",
        { kind: "gemini_generate_content", model: "models/x:other?key=1" },
        "a gemini_generate_content model is a bare model id",
      ],
      [
        "a parent path in its model",
        { kind: "gemini_generate_content", model: "../tunedModels/x" },
        "a gemini_generate_content model is a bare model id",
      ],
    ])("refuses a Gemini backend with %s, naming it", (_name, backend, issue) => {
      const parsed = instantEvalJudgeRouteTableSchema.safeParse(
        gatedTable({ backends: { extra: backend } }),
      );
      expect(parsed.success).toBe(false);
      expect(JSON.stringify(parsed.error?.issues)).toContain(`backend extra: `);
      expect(JSON.stringify(parsed.error?.issues)).toContain(issue);
    });

    /** @scenario "A backend that reasons waits long enough to write its output cap" */
    it("refuses an effort on a backend whose timeout is below the floor, naming both", () => {
      const parsed = instantEvalJudgeRouteTableSchema.safeParse(
        gatedTable({
          backends: {
            "llm-b": {
              kind: "openai_responses",
              model: "m",
              reasoningEffort: "high",
              timeoutMs: 299_999,
            },
          },
        }),
      );
      expect(parsed.success).toBe(false);
      expect(JSON.stringify(parsed.error?.issues)).toContain(
        "backend llm-b: reasoningEffort high needs a timeoutMs of at least 300000",
      );
    });

    /** @scenario "A reasoning effort is sent only when the backend sets one" */
    it("refuses an effort the provider does not name", () => {
      const table = gatedTable({
        backends: { "llm-b": { kind: "openai_responses", model: "m", reasoningEffort: "max" } },
      });
      expect(instantEvalJudgeRouteTableSchema.validate(table)).toBe(false);
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

describe("given an OpenAI Responses backend that sets a reasoning effort", () => {
  /** @scenario "A reasoning effort is sent only when the backend sets one" */
  it.each(["none", "minimal", "low", "medium", "high"])(
    "takes the effort %s that the provider names",
    (effort) => {
      const parsed = instantEvalJudgeRouteTableSchema.parse(
        gatedTable({
          backends: {
            "llm-b": { kind: "openai_responses", model: "m", reasoningEffort: effort },
          },
        }),
      );
      expect(parsed.backends["llm-b"]?.reasoningEffort).toBe(effort);
    },
  );

  /** @scenario "A backend that reasons waits long enough to write its output cap" */
  it.each([
    ["high", undefined, 300_000],
    ["minimal", undefined, 300_000],
    ["none", undefined, 30_000],
    [undefined, undefined, 30_000],
    ["high", 400_000, 400_000],
  ] as const)(
    "gives effort %s with timeout %s a timeout of %i ms",
    (effort, timeoutMs, expected) => {
      const parsed = instantEvalJudgeRouteTableSchema.parse(
        gatedTable({
          backends: {
            "llm-b": {
              kind: "openai_responses",
              model: "m",
              ...(effort ? { reasoningEffort: effort } : {}),
              ...(timeoutMs ? { timeoutMs } : {}),
            },
          },
        }),
      );
      expect(parsed.backends["llm-b"]?.timeoutMs).toBe(expected);
    },
  );

  const capped = (backend: Record<string, unknown>) =>
    instantEvalJudgeRouteTableSchema.safeParse(
      gatedTable({
        backends: {
          "llm-b": { kind: "openai_responses", model: "m", reasoningEffort: "high", ...backend },
        },
      }),
    );

  /** @scenario "A backend that reasons waits long enough to write its output cap" */
  it.each([
    [1_100, undefined, 22_000],
    [2_200, undefined, 44_000],
    [1_100, 22_000, 22_000],
    [1_001, undefined, 20_020],
  ] as const)(
    "takes its own cap of %i tokens with timeout %s as %i ms",
    (maxOutputTokens, timeoutMs, expected) => {
      const parsed = capped({ maxOutputTokens, ...(timeoutMs ? { timeoutMs } : {}) });
      expect(parsed.success).toBe(true);
      expect(parsed.data?.backends["llm-b"]?.timeoutMs).toBe(expected);
      expect(parsed.data?.backends["llm-b"]?.maxOutputTokens).toBe(maxOutputTokens);
    },
  );

  /** @scenario "A backend that reasons waits long enough to write its output cap" */
  it("refuses a timeout too short to write its own cap at 50 tokens a second, naming both", () => {
    const parsed = capped({ maxOutputTokens: 1_100, timeoutMs: 21_999 });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain(
      "backend llm-b: reasoningEffort high and maxOutputTokens 1100 needs a timeoutMs of at least 22000",
    );
  });

  /** @scenario "A backend that reasons waits long enough to write its output cap" */
  it("still refuses a timeout under 300,000 ms where the backend sets no cap of its own", () => {
    expect(capped({ timeoutMs: 10_000 }).success).toBe(false);
  });
});

describe("given a backend that sets its own output cap", () => {
  /** @scenario "A backend that reasons waits long enough to write its output cap" */
  it.each([
    ["jev", { kind: "jev", maxOutputTokens: 100 }],
    ["decisions", { kind: "decisions", model: "decision-model-a", maxOutputTokens: 100 }],
  ] as const)("refuses it on a %s backend", (kind, extra) => {
    const parsed = instantEvalJudgeRouteTableSchema.safeParse(gatedTable({ backends: { extra } }));
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain(
      `backend extra: a ${kind} backend takes no maxOutputTokens`,
    );
  });

  /** @scenario "A backend that reasons waits long enough to write its output cap" */
  it("keeps the 30,000 ms default on a backend that does not reason", () => {
    const parsed = instantEvalJudgeRouteTableSchema.parse(
      gatedTable({
        backends: { "llm-b": { kind: "anthropic_messages", model: "m", maxOutputTokens: 500 } },
      }),
    );
    expect(parsed.backends["llm-b"]).toMatchObject({ timeoutMs: 30_000, maxOutputTokens: 500 });
  });

  /** @scenario "A backend that reasons waits long enough to write its output cap" */
  it("takes it on a Gemini backend, as on the other LLM kinds", () => {
    const parsed = instantEvalJudgeRouteTableSchema.safeParse(
      gatedTable({
        backends: {
          "llm-g": {
            kind: "gemini_generate_content",
            model: "gemini-2.5-pro",
            maxOutputTokens: 500,
          },
        },
      }),
    );
    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.data?.backends["llm-g"]).toMatchObject({ maxOutputTokens: 500 });
  });
});

describe("given a gated entry", () => {
  const table = instantEvalJudgeRouteTableSchema.parse(gatedTable());
  const gated = table.routes.llm_judge.all!.balanced!;

  /** @scenario "A gate names a hosted classifier backend and an escalation, nothing else" */
  it("counts the gate among the backends the entry may call, first", () => {
    expect(instantEvalJudgeEntryBackends(gated)).toEqual(["gate-a", "decision-a", "llm-b"]);
  });

  /** @scenario "A gate names a hosted classifier backend and an escalation, nothing else" */
  it("is unusable when its gate backend is switched off", () => {
    const off = instantEvalJudgeRouteTableSchema.parse(
      gatedTable({ backends: { "gate-a": { kind: "jev", enabled: false } } }),
    );
    expect(isInstantEvalJudgeEntryEnabled({ entry: gated, table: off })).toBe(false);
    expect(isInstantEvalJudgeEntryEnabled({ entry: gated, table })).toBe(true);
  });

  /** @scenario "A scenario route's backends never raise a judged query's hold" */
  it("lists the slots of the named jobs only, with each routed kind's default", () => {
    const withKinds = instantEvalJudgeRouteTableSchema.parse({
      ...gatedTable(),
      kinds: {
        score: {
          sureness: "spread",
          default: { instant: { primary: "llm-b" } },
          routes: { scenario_judge: { all: { instant: { primary: "decision-a" } } } },
        },
      },
    });
    const primaries = (jobs?: readonly ("search" | "llm_judge" | "scenario_judge")[]) =>
      instantEvalJudgeRouteSlotsOf(withKinds, jobs).map((routeSlot) => routeSlot.instant.primary);
    expect(primaries(["search"])).toEqual(["jev", "jev", "llm-b"]);
    expect(primaries(["scenario_judge"])).toEqual(["jev", "jev", "llm-b", "decision-a"]);
    expect(primaries()).toHaveLength(8);
  });
});

describe("given backends that are switched off", () => {
  const table = instantEvalJudgeRouteTableSchema.parse(
    tableWith({
      backends: {
        jev: { kind: "jev", fallbacks: ["llm-a", "llm-b"] },
        "llm-a": { kind: "anthropic_messages", model: "llm-model-a", enabled: false },
        "llm-b": { kind: "anthropic_messages", model: "llm-model-b" },
      },
    }),
  );

  it("an entry is usable only when every backend it may call is on", () => {
    expect(isInstantEvalJudgeEntryEnabled({ entry: { primary: "jev" }, table })).toBe(true);
    const escalating = { primary: "jev", escalateTo: "llm-a", threshold: 0.5 };
    expect(isInstantEvalJudgeEntryEnabled({ entry: escalating, table })).toBe(false);
  });

  it("a backend falls back only to the fallbacks that are on, in order", () => {
    expect(instantEvalJudgeEnabledFallbacksOf({ backend: "jev", table })).toEqual(["llm-b"]);
    expect(instantEvalJudgeEnabledFallbacksOf({ backend: "unknown", table })).toEqual([]);
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
    ).toEqual(["score / default / instant: escalateTo needs a threshold or a gate"]);
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
