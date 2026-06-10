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
});
