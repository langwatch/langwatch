import { describe, expect, it } from "vitest";
import type { Span } from "../../../server/tracer/types";
import { getEvaluationResult } from "../SpanDetails";

function buildSpan(output: Span["output"]): Span {
  return {
    span_id: "span-1",
    trace_id: "trace-1",
    name: "eval-span",
    type: "evaluation",
    input: null,
    output,
    timestamps: { started_at: 1000, finished_at: 2000 },
    params: null,
  } as Span;
}

describe("getEvaluationResult", () => {
  describe("when output type is evaluation_result", () => {
    it("returns the parsed evaluation result", () => {
      const span = buildSpan({
        type: "evaluation_result",
        value: { status: "processed", passed: true, score: 0.95 },
      });

      const result = getEvaluationResult(span);

      expect(result).toEqual({
        status: "processed",
        passed: true,
        score: 0.95,
      });
    });

    it("parses JSON string value", () => {
      const span = buildSpan({
        type: "evaluation_result",
        value: JSON.stringify({
          status: "processed",
          passed: false,
          score: 0.1,
        }) as unknown,
      } as Span["output"]);

      const result = getEvaluationResult(span);

      expect(result).toEqual({
        status: "processed",
        passed: false,
        score: 0.1,
      });
    });
  });

  describe("when output type is not evaluation_result", () => {
    it("returns undefined for json output type", () => {
      const span = buildSpan({
        type: "json",
        value: { status: "processed", passed: true },
      });

      const result = getEvaluationResult(span);

      expect(result).toBeUndefined();
    });

    it("returns undefined for text output type", () => {
      const span = buildSpan({
        type: "text",
        value: "some text",
      });

      const result = getEvaluationResult(span);

      expect(result).toBeUndefined();
    });
  });

  describe("when output is null or has no value", () => {
    it("returns undefined for null output", () => {
      const span = buildSpan(null);

      const result = getEvaluationResult(span);

      expect(result).toBeUndefined();
    });

    it("returns undefined when output value is empty", () => {
      const span = buildSpan({
        type: "evaluation_result",
        value: undefined as never,
      });

      const result = getEvaluationResult(span);

      expect(result).toBeUndefined();
    });
  });
});
