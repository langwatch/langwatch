import { describe, expect, it } from "vitest";
import {
  aggregateScenarioRoleMetrics,
  type ScenarioRoleSpanInput,
} from "../scenario-role-metrics.rules";

function makeSpan(overrides: Partial<ScenarioRoleSpanInput> = {}): ScenarioRoleSpanInput {
  return {
    spanId: "span-1",
    parentSpanId: null,
    role: undefined,
    cost: 0,
    durationMs: 0,
    ...overrides,
  };
}

describe("aggregateScenarioRoleMetrics", () => {
  describe("given a trace with spans carrying a role attribute", () => {
    /** @scenario "Trace summary fold accumulates per-role cost and latency from spans" */
    it("accumulates per-role cost and latency", () => {
      const spans: ScenarioRoleSpanInput[] = [
        makeSpan({ spanId: "agent", role: "Agent", cost: 0.003, durationMs: 1200 }),
        makeSpan({ spanId: "user", role: "User", cost: 0.001, durationMs: 800 }),
        makeSpan({ spanId: "judge", role: "Judge", cost: 0.002, durationMs: 500 }),
      ];

      const result = aggregateScenarioRoleMetrics(spans);

      expect(result.scenarioRoleCosts).toEqual({ Agent: 0.003, User: 0.001, Judge: 0.002 });
      expect(result.scenarioRoleLatencies).toEqual({ Agent: 1200, User: 800, Judge: 500 });
    });
  });

  describe("given a trace with spans that carry no role attribute", () => {
    /** @scenario "Trace summary fold ignores spans without role attribute" */
    it("leaves roleCosts and roleLatencies empty", () => {
      const spans: ScenarioRoleSpanInput[] = [
        makeSpan({ spanId: "a", role: undefined, cost: 0.001, durationMs: 100 }),
        makeSpan({ spanId: "b", role: undefined, cost: 0.002, durationMs: 200 }),
      ];

      const result = aggregateScenarioRoleMetrics(spans);

      expect(result.scenarioRoleCosts).toEqual({});
      expect(result.scenarioRoleLatencies).toEqual({});
    });
  });
});
