import { describe, expect, it } from "vitest";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { createInitState, createTestSpan } from "./fixtures/trace-summary-test.fixtures";

/**
 * Regression guard for the O(n^2) fold incident: a single long-lived trace
 * (one trace_id reused for thousands of spans) used to grow the fold state
 * O(span-count) because span-count-scaling collections (events, scenario role
 * maps, span costs) were copied + re-serialized on every span. That turned the
 * per-event read-modify-write into O(n) and the whole trace into O(n^2).
 *
 * These collections are now derived from stored_spans at read time, so the fold
 * state is pure O(1) scalars. This test folds many spans (each carrying an
 * event) and asserts the serialized state does not grow with span count.
 */
function foldNSpans(n: number): TraceSummaryData {
  let state = createInitState();
  for (let i = 0; i < n; i++) {
    const span = createTestSpan({
      id: `span-${i}`,
      spanId: `span-${i}`,
      parentSpanId: i === 0 ? null : "span-0",
      startTimeUnixMs: 1000 + i,
      endTimeUnixMs: 2000 + i,
      durationMs: 1000,
      spanAttributes: {
        "langwatch.span.type": "llm",
        "gen_ai.request.model": "gpt-5-mini",
        "gen_ai.response.model": "gpt-5-mini",
        "gen_ai.usage.input_tokens": 10,
        "gen_ai.usage.output_tokens": 5,
      },
      events: [
        { name: "thumbs_up_down", timeUnixMs: 1500 + i, attributes: { value: "up" } },
      ],
    });
    state = applySpanToSummary({ state, span });
  }
  return state;
}

describe("trace summary fold state size", () => {
  describe("given a trace with many spans each carrying an event", () => {
    it("does not grow the fold state with span count (flat O(1))", () => {
      const small = foldNSpans(10);
      const large = foldNSpans(5000);

      // The fold counts every span (this is a scalar, expected to differ).
      expect(small.spanCount).toBe(10);
      expect(large.spanCount).toBe(5000);

      // But the serialized state must not scale with span count: with the
      // span-count-scaling collections removed, 5000 spans serialize to
      // essentially the same size as 10 (only scalar counters differ, which
      // adds a few bytes for larger numbers).
      const smallSize = JSON.stringify(small).length;
      const largeSize = JSON.stringify(large).length;
      expect(largeSize - smallSize).toBeLessThan(50);

      // And no span-count-scaling collection leaked back onto the state.
      expect(large).not.toHaveProperty("events");
      expect(large).not.toHaveProperty("scenarioRoleSpans");
      expect(large).not.toHaveProperty("scenarioRoleCosts");
      expect(large).not.toHaveProperty("spanCosts");
    });
  });
});
