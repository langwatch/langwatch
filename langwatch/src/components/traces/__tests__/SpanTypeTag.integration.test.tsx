/**
 * @vitest-environment jsdom
 *
 * Integration tests for the SpanTypeTag component.
 * Verifies that evaluation spans render correctly and that the evaluation result
 * is properly extracted for styling decisions.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Span } from "../../../server/tracer/types";
import { getEvaluationResult, SpanTypeTag } from "../SpanDetails";

function buildEvaluationSpan(output: Span["output"]): Span {
  return {
    span_id: "span-eval-1",
    trace_id: "trace-1",
    name: "My Evaluation",
    type: "evaluation",
    input: null,
    output,
    timestamps: { started_at: 1000, finished_at: 2000 },
    params: null,
  } as Span;
}

afterEach(cleanup);

describe("<SpanTypeTag/>", () => {
  describe("when evaluation span has evaluation_result output with passed=true", () => {
    it("renders EVALUATION badge text", () => {
      const span = buildEvaluationSpan({
        type: "evaluation_result",
        value: { status: "processed", passed: true, score: 0.95 },
      });

      render(
        <ChakraProvider value={defaultSystem}>
          <SpanTypeTag span={span} />
        </ChakraProvider>,
      );

      expect(screen.getByText("EVALUATION")).toBeDefined();
    });

    it("extracts evaluation result for styling", () => {
      const span = buildEvaluationSpan({
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
  });

  describe("when evaluation span has evaluation_result output with passed=false", () => {
    it("extracts failed evaluation result for styling", () => {
      const span = buildEvaluationSpan({
        type: "evaluation_result",
        value: { status: "processed", passed: false, score: 0.1 },
      });

      const result = getEvaluationResult(span);

      expect(result?.passed).toBe(false);
    });
  });

  describe("when evaluation span has json output type (the bug this fix addresses)", () => {
    it("does not extract evaluation result — badge falls to gray", () => {
      const span = buildEvaluationSpan({
        type: "json",
        value: { status: "processed", passed: true, score: 0.95 },
      });

      const result = getEvaluationResult(span);

      expect(result).toBeUndefined();
    });
  });

  describe("when evaluation span has no output", () => {
    it("renders EVALUATION badge without evaluation result", () => {
      const span = buildEvaluationSpan(null);

      render(
        <ChakraProvider value={defaultSystem}>
          <SpanTypeTag span={span} />
        </ChakraProvider>,
      );

      expect(screen.getByText("EVALUATION")).toBeDefined();
      expect(getEvaluationResult(span)).toBeUndefined();
    });
  });

  describe("when span is an LLM type", () => {
    it("renders LLM badge", () => {
      const span = {
        ...buildEvaluationSpan(null),
        type: "llm" as const,
        name: "gpt-4",
      } as Span;

      render(
        <ChakraProvider value={defaultSystem}>
          <SpanTypeTag span={span} />
        </ChakraProvider>,
      );

      expect(screen.getByText("LLM")).toBeDefined();
    });
  });
});
