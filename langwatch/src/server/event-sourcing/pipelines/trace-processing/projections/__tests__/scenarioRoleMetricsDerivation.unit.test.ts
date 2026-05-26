import { describe, expect, it } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";
import { SpanCostService } from "../services/span-cost.service";
import { ScenarioRoleCostService } from "../services/scenario-role-cost.service";
import {
  aggregateScenarioRoleMetrics,
  deriveScenarioRoleMetricsFromSpans,
  type ScenarioRoleSpanInput,
} from "../services/scenario-role-metrics.derivation";
import { createInitState, createTestSpan } from "./fixtures/trace-summary-test.fixtures";

/**
 * The read-time scenario-role aggregator replaces the per-event fold
 * bookkeeping (scenarioRoleSpans + spanCosts) that grew O(n) with span count.
 * These tests pin its arithmetic and prove it produces IDENTICAL
 * scenarioRoleCosts / scenarioRoleLatencies to the legacy incremental
 * ScenarioRoleCostService for the same span set, regardless of arrival order.
 */

const spanCostService = new SpanCostService();
const scenarioRoleCostService = new ScenarioRoleCostService(spanCostService);

/**
 * Folds spans through the legacy incremental service the same way the fold
 * projection did, returning the final scenario role metrics.
 */
function legacyFold(spans: NormalizedSpan[]): {
  scenarioRoleCosts: Record<string, number>;
  scenarioRoleLatencies: Record<string, number>;
} {
  let state = createInitState();
  for (const span of spans) {
    const result = scenarioRoleCostService.accumulateRoleCostLatency({
      state,
      span,
    });
    state = { ...state, ...result } as TraceSummaryData;
  }
  return {
    scenarioRoleCosts: state.scenarioRoleCosts ?? {},
    scenarioRoleLatencies: state.scenarioRoleLatencies ?? {},
  };
}

function llmSpan(
  spanId: string,
  parentSpanId: string | null,
  overrides: Partial<NormalizedSpan> = {},
): NormalizedSpan {
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
    ...overrides,
  });
}

function agentSpan(
  spanId: string,
  parentSpanId: string | null,
  role: string,
  overrides: Partial<NormalizedSpan> = {},
): NormalizedSpan {
  return createTestSpan({
    id: spanId,
    spanId,
    parentSpanId,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 4000,
    durationMs: 3000,
    spanAttributes: { "scenario.role": role },
    ...overrides,
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

      expect(aggregateScenarioRoleMetrics(inputs).scenarioRoleCosts).toEqual({
        user: 0.30000000000000004,
      });
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

describe("deriveScenarioRoleMetricsFromSpans parity with legacy incremental fold", () => {
  const userAgent = agentSpan("user-agent", null, "user");
  const userLlm = llmSpan("user-llm", "user-agent");
  const asstAgent = agentSpan("asst-agent", null, "assistant");
  const asstLlm = llmSpan("asst-llm", "asst-agent");
  const asstNestedLlm = llmSpan("asst-nested", "asst-llm");

  const spans = [userAgent, userLlm, asstAgent, asstLlm, asstNestedLlm];

  describe("when spans arrive parent-before-children (in order)", () => {
    it("matches the legacy service output", () => {
      const derived = deriveScenarioRoleMetricsFromSpans({ spans, spanCostService });
      expect(derived).toEqual(legacyFold(spans));
    });
  });

  describe("when a child LLM span arrives before its role-bearing parent", () => {
    it("matches the legacy service output (retroactive assignment parity)", () => {
      const outOfOrder = [userLlm, asstLlm, asstNestedLlm, userAgent, asstAgent];
      const derived = deriveScenarioRoleMetricsFromSpans({
        spans: outOfOrder,
        spanCostService,
      });
      expect(derived).toEqual(legacyFold(outOfOrder));
    });
  });

  describe("when the trace has no scenario roles", () => {
    it("both produce empty maps", () => {
      const plain = [llmSpan("a", null), llmSpan("b", "a")];
      const derived = deriveScenarioRoleMetricsFromSpans({
        spans: plain,
        spanCostService,
      });
      expect(derived).toEqual(legacyFold(plain));
      expect(derived.scenarioRoleCosts).toEqual({});
    });
  });
});
