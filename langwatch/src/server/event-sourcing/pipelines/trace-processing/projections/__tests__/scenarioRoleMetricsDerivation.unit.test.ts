import { describe, expect, it } from "vitest";
import type { NormalizedSpan } from "../../schemas/spans";
import { SpanCostService } from "../services/span-cost.service";
import {
  aggregateScenarioRoleMetrics,
  deriveScenarioRoleMetricsFromSpans,
  type ScenarioRoleSpanInput,
} from "../services/scenario-role-metrics.derivation";
import { createTestSpan } from "./fixtures/trace-summary-test.fixtures";

/**
 * The read-time scenario-role aggregator replaces the per-event fold
 * bookkeeping (scenarioRoleSpans + spanCosts) that grew O(n) with span count.
 * These tests pin its arithmetic (nearest-ancestor role resolution, cost
 * summation, latency from direct-role spans only) and that it is independent
 * of span arrival order, since it operates over the complete span set.
 */

const spanCostService = new SpanCostService();

function llmSpan(spanId: string, parentSpanId: string | null): NormalizedSpan {
  return createTestSpan({
    id: spanId,
    spanId,
    parentSpanId,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 3000,
    durationMs: 2000,
    spanAttributes: {
      "langwatch.span.type": "llm",
      "gen_ai.request.model": "gpt-5-mini",
      "gen_ai.response.model": "gpt-5-mini",
      "gen_ai.usage.input_tokens": 1000,
      "gen_ai.usage.output_tokens": 500,
    },
  });
}

function agentSpan(
  spanId: string,
  parentSpanId: string | null,
  role: string,
  durationMs = 3000,
): NormalizedSpan {
  return createTestSpan({
    id: spanId,
    spanId,
    parentSpanId,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 1000 + durationMs,
    durationMs,
    spanAttributes: { "scenario.role": role },
  });
}

describe("aggregateScenarioRoleMetrics", () => {
  describe("given a non-scenario trace (no role-bearing spans)", () => {
    it("returns empty cost and latency maps", () => {
      const inputs: ScenarioRoleSpanInput[] = [
        { spanId: "a", parentSpanId: null, role: undefined, cost: 0.5, durationMs: 100 },
        { spanId: "b", parentSpanId: "a", role: undefined, cost: 0.5, durationMs: 100 },
      ];

      expect(aggregateScenarioRoleMetrics(inputs)).toEqual({
        scenarioRoleCosts: {},
        scenarioRoleLatencies: {},
      });
    });
  });

  describe("given a child LLM span under a role-bearing agent span", () => {
    it("attributes the child cost to the ancestor's role", () => {
      const inputs: ScenarioRoleSpanInput[] = [
        { spanId: "agent", parentSpanId: null, role: "assistant", cost: 0, durationMs: 3000 },
        { spanId: "llm", parentSpanId: "agent", role: undefined, cost: 0.42, durationMs: 2000 },
      ];

      expect(aggregateScenarioRoleMetrics(inputs)).toEqual({
        scenarioRoleCosts: { assistant: 0.42 },
        scenarioRoleLatencies: { assistant: 3000 },
      });
    });
  });

  describe("given deeply nested spans under a role", () => {
    it("propagates the role transitively to all descendants", () => {
      const inputs: ScenarioRoleSpanInput[] = [
        { spanId: "agent", parentSpanId: null, role: "user", cost: 0, durationMs: 1000 },
        { spanId: "gen", parentSpanId: "agent", role: undefined, cost: 0.1, durationMs: 500 },
        { spanId: "doGen", parentSpanId: "gen", role: undefined, cost: 0.2, durationMs: 300 },
      ];

      const { scenarioRoleCosts } = aggregateScenarioRoleMetrics(inputs);
      expect(Object.keys(scenarioRoleCosts)).toEqual(["user"]);
      expect(scenarioRoleCosts.user).toBeCloseTo(0.3);
    });
  });

  describe("given two roles in one trace", () => {
    it("sums cost under each span's nearest role ancestor", () => {
      const inputs: ScenarioRoleSpanInput[] = [
        { spanId: "user", parentSpanId: null, role: "user", cost: 0, durationMs: 1000 },
        { spanId: "userLlm", parentSpanId: "user", role: undefined, cost: 1, durationMs: 500 },
        { spanId: "asst", parentSpanId: null, role: "assistant", cost: 0, durationMs: 2000 },
        { spanId: "asstLlm", parentSpanId: "asst", role: undefined, cost: 3, durationMs: 800 },
      ];

      expect(aggregateScenarioRoleMetrics(inputs)).toEqual({
        scenarioRoleCosts: { user: 1, assistant: 3 },
        scenarioRoleLatencies: { user: 1000, assistant: 2000 },
      });
    });
  });

  describe("given a span whose parent is missing from the trace", () => {
    it("does not assign a role and terminates without recursing", () => {
      const inputs: ScenarioRoleSpanInput[] = [
        { spanId: "orphan", parentSpanId: "not-in-trace", role: undefined, cost: 5, durationMs: 100 },
      ];

      expect(aggregateScenarioRoleMetrics(inputs)).toEqual({
        scenarioRoleCosts: {},
        scenarioRoleLatencies: {},
      });
    });
  });

  describe("given a parent cycle (malformed parent links)", () => {
    it("terminates instead of recursing forever", () => {
      const inputs: ScenarioRoleSpanInput[] = [
        { spanId: "a", parentSpanId: "b", role: undefined, cost: 1, durationMs: 10 },
        { spanId: "b", parentSpanId: "a", role: undefined, cost: 1, durationMs: 10 },
      ];

      expect(aggregateScenarioRoleMetrics(inputs)).toEqual({
        scenarioRoleCosts: {},
        scenarioRoleLatencies: {},
      });
    });
  });
});

describe("deriveScenarioRoleMetricsFromSpans", () => {
  const userAgent = agentSpan("user-agent", null, "user", 1500);
  const userLlm = llmSpan("user-llm", "user-agent");
  const asstAgent = agentSpan("asst-agent", null, "assistant", 2500);
  const asstLlm = llmSpan("asst-llm", "asst-agent");
  const asstNestedLlm = llmSpan("asst-nested", "asst-llm");

  const inOrder = [userAgent, userLlm, asstAgent, asstLlm, asstNestedLlm];
  // children before their role-bearing parents (the common OTel export order)
  const outOfOrder = [userLlm, asstLlm, asstNestedLlm, userAgent, asstAgent];

  describe("when spans arrive in any order", () => {
    it("produces the same result (operates over the complete set)", () => {
      const a = deriveScenarioRoleMetricsFromSpans({ spans: inOrder, spanCostService });
      const b = deriveScenarioRoleMetricsFromSpans({ spans: outOfOrder, spanCostService });
      expect(a).toEqual(b);
    });
  });

  describe("when role-bearing spans carry durations", () => {
    it("sums latency per direct role from the role span itself", () => {
      const { scenarioRoleLatencies } = deriveScenarioRoleMetricsFromSpans({
        spans: inOrder,
        spanCostService,
      });
      expect(scenarioRoleLatencies).toEqual({ user: 1500, assistant: 2500 });
    });
  });

  describe("when costed LLM spans nest under roles", () => {
    it("attributes each LLM's cost to its nearest role ancestor and sums per role", () => {
      const perLlmCost = spanCostService.extractTokenMetrics(userLlm).cost;
      const { scenarioRoleCosts } = deriveScenarioRoleMetricsFromSpans({
        spans: inOrder,
        spanCostService,
      });

      if (perLlmCost > 0) {
        // user role: 1 LLM (user-llm); assistant role: 2 LLMs (asst-llm +
        // asst-nested, the nested one resolves to assistant via its chain).
        expect(scenarioRoleCosts.user).toBeCloseTo(perLlmCost);
        expect(scenarioRoleCosts.assistant).toBeCloseTo(perLlmCost * 2);
      } else {
        expect(scenarioRoleCosts).toEqual({});
      }
    });
  });

  describe("when the trace has no scenario roles", () => {
    it("produces empty maps", () => {
      const plain = [llmSpan("a", null), llmSpan("b", "a")];
      expect(
        deriveScenarioRoleMetricsFromSpans({ spans: plain, spanCostService }),
      ).toEqual({ scenarioRoleCosts: {}, scenarioRoleLatencies: {} });
    });
  });
});
