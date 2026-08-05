import { describe, expect, it } from "vitest";

import type { Trace } from "~/server/tracer/types";
import { applyTraceProtections } from "../redaction";

function traceWithIO(): Trace {
  return {
    trace_id: "trace-1",
    project_id: "project-1",
    input: { value: "the secret question" },
    output: { value: "the answer" },
    metrics: {
      total_cost: 0.0123,
      prompt_tokens: 42,
      completion_tokens: 7,
      total_time_ms: 1200,
      first_token_ms: 300,
      tokens_estimated: false,
    },
    timestamps: { started_at: 1, inserted_at: 2, updated_at: 3 },
  } as unknown as Trace;
}

/**
 * A trace whose only span carries the drop marker the ingestion strip stamps.
 * The span mapper unflattens the `langwatch.privacy.dropped` attribute into this
 * nested path under `params`, so that is the shape the read-time mapper sees.
 */
function traceWithDroppedSpan(markerValue: string): Trace {
  return {
    trace_id: "trace-2",
    project_id: "project-1",
    metadata: {},
    timestamps: { started_at: 1, inserted_at: 2, updated_at: 3 },
    spans: [
      {
        span_id: "span-1",
        trace_id: "trace-2",
        type: "span",
        timestamps: { started_at: 1, finished_at: 2 },
        params: { langwatch: { privacy: { dropped: markerValue } } },
      },
    ],
  } as unknown as Trace;
}

const visibleToAll = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

describe("applyTraceProtections metadata preservation", () => {
  describe("when input is restricted but the viewer keeps cost access", () => {
    /** @scenario Restricting content does not hide its metadata */
    it("hides the input while keeping token counts, cost, and latency", () => {
      const result = applyTraceProtections(traceWithIO(), {
        canSeeCapturedInput: false,
        canSeeCapturedOutput: true,
        canSeeCosts: true,
      });

      expect(result.input).toBeUndefined();
      expect(result.output?.value).toBe("the answer");
      expect(result.metrics?.prompt_tokens).toBe(42);
      expect(result.metrics?.completion_tokens).toBe(7);
      expect(result.metrics?.total_time_ms).toBe(1200);
      expect(result.metrics?.first_token_ms).toBe(300);
      expect(result.metrics?.total_cost).toBe(0.0123);
    });
  });

  describe("when a drop privacy policy stripped content at ingestion", () => {
    /** @scenario The trace view marks content a privacy policy dropped */
    it("surfaces the dropped categories from the span marker", () => {
      const result = applyTraceProtections(
        traceWithDroppedSpan("input,output"),
        visibleToAll,
      );

      expect(result.privacy?.droppedCategories).toEqual(["input", "output"]);
    });

    it("orders categories stably regardless of the marker order", () => {
      const result = applyTraceProtections(
        traceWithDroppedSpan("tools,input"),
        visibleToAll,
      );

      expect(result.privacy?.droppedCategories).toEqual(["input", "tools"]);
    });

    it("leaves privacy unset when no span carries a drop marker", () => {
      const result = applyTraceProtections(traceWithIO(), visibleToAll);

      expect(result.privacy).toBeUndefined();
    });
  });
});
