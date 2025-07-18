import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Span } from "../../../tracer/types";
import {
  addLLMTokensCount,
  computeTraceMetrics,
  addGuardrailCosts,
} from "./metrics";

// Mock the LLM model costs
vi.mock("../../../modelProviders/llmModelCost", () => ({
  getLLMModelCosts: vi.fn().mockResolvedValue({
    "gpt-4o-mini": {
      input_cost_per_1k_tokens: 0.00015,
      output_cost_per_1k_tokens: 0.0006,
    },
    "gpt-4": {
      input_cost_per_1k_tokens: 0.03,
      output_cost_per_1k_tokens: 0.06,
    },
  }),
}));

// Mock the cost estimation
vi.mock("./cost", () => ({
  estimateCost: vi.fn(({ llmModelCost, inputTokens, outputTokens }) => {
    return (
      (llmModelCost.input_cost_per_1k_tokens * inputTokens) / 1000 +
      (llmModelCost.output_cost_per_1k_tokens * outputTokens) / 1000
    );
  }),
  matchingLLMModelCost: vi.fn((model, costs) => costs[model]),
  tokenizeAndEstimateCost: vi.fn().mockResolvedValue({
    inputTokens: 100,
    outputTokens: 50,
  }),
}));

describe("Trace metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("computeTraceMetrics", () => {
    it("should calculate total cost from multiple spans with costs", () => {
      const spans: Span[] = [
        {
          trace_id: "trace_1",
          span_id: "span_1",
          type: "llm",
          name: "First LLM Call",
          timestamps: {
            started_at: 1000,
            finished_at: 2000,
          },
          metrics: {
            cost: 0.0001,
            prompt_tokens: 100,
            completion_tokens: 50,
          } as any,
        },
        {
          trace_id: "trace_1",
          span_id: "span_2",
          type: "llm",
          name: "Second LLM Call",
          timestamps: {
            started_at: 1500,
            finished_at: 2500,
          },
          metrics: {
            cost: 0.0002,
            prompt_tokens: 200,
            completion_tokens: 100,
          } as any,
        },
        {
          trace_id: "trace_1",
          span_id: "span_3",
          type: "span",
          name: "Processing",
          timestamps: {
            started_at: 1200,
            finished_at: 1800,
          },
          // No metrics - should not affect cost calculation
        },
      ];

      const metrics = computeTraceMetrics(spans);

      expect(metrics!.total_cost).toBeCloseTo(0.0003, 10); // 0.0001 + 0.0002
      expect(metrics!.prompt_tokens).toBe(300); // 100 + 200
      expect(metrics!.completion_tokens).toBe(150); // 50 + 100
      expect(metrics!.total_time_ms).toBe(1500); // 2500 - 1000
      expect(metrics!.first_token_ms).toBeNull(); // No first_token_at timestamps
    });

    it("should handle spans with undefined or null costs", () => {
      const spans: Span[] = [
        {
          trace_id: "trace_1",
          span_id: "span_1",
          type: "llm",
          name: "LLM Call with Cost",
          timestamps: {
            started_at: 1000,
            finished_at: 2000,
          },
          metrics: {
            cost: 0.0001,
            prompt_tokens: 100,
            completion_tokens: 50,
          },
        },
        {
          trace_id: "trace_1",
          span_id: "span_2",
          type: "llm",
          name: "LLM Call without Cost",
          timestamps: {
            started_at: 1500,
            finished_at: 2500,
          },
          metrics: {
            cost: undefined, // Should be ignored
            prompt_tokens: 200,
            completion_tokens: 100,
          } as any,
        },
        {
          trace_id: "trace_1",
          span_id: "span_3",
          type: "span",
          name: "Processing",
          timestamps: {
            started_at: 1200,
            finished_at: 1800,
          },
          metrics: {
            cost: null, // Should be ignored
          },
        },
      ];

      const metrics = computeTraceMetrics(spans);

      expect(metrics!.total_cost).toBe(0.0001); // Only the first span's cost
      expect(metrics!.prompt_tokens).toBe(300); // 100 + 200
      expect(metrics!.completion_tokens).toBe(150); // 50 + 100
    });

    it("should return null for total_cost when no spans have costs", () => {
      const spans: Span[] = [
        {
          trace_id: "trace_1",
          span_id: "span_1",
          type: "span",
          name: "Processing",
          timestamps: {
            started_at: 1000,
            finished_at: 2000,
          },
          // No metrics
        },
        {
          trace_id: "trace_1",
          span_id: "span_2",
          type: "llm",
          name: "LLM Call",
          timestamps: {
            started_at: 1500,
            finished_at: 2500,
          },
          metrics: {
            cost: undefined,
            prompt_tokens: 100,
            completion_tokens: 50,
          },
        },
      ];

      const metrics = computeTraceMetrics(spans);

      expect(metrics!.total_cost).toBeNull();
      expect(metrics!.prompt_tokens).toBe(100);
      expect(metrics!.completion_tokens).toBe(50);
    });

    it("should handle empty spans array", () => {
      const metrics = computeTraceMetrics([]);

      expect(metrics!.total_cost).toBeNull();
      expect(metrics!.prompt_tokens).toBeNull();
      expect(metrics!.completion_tokens).toBeNull();
      expect(metrics!.total_time_ms).toBeNull();
      expect(metrics!.first_token_ms).toBeNull();
      expect(metrics!.tokens_estimated).toBe(false);
    });

    it("should calculate first_token_ms when first_token_at is available", () => {
      const spans: Span[] = [
        {
          trace_id: "trace_1",
          span_id: "span_1",
          type: "llm",
          name: "LLM Call",
          timestamps: {
            started_at: 1000,
            first_token_at: 1200,
            finished_at: 2000,
          },
          metrics: {
            cost: 0.0001,
          },
        },
      ];

      const metrics = computeTraceMetrics(spans);

      expect(metrics!.first_token_ms).toBe(200); // 1200 - 1000
      expect(metrics!.total_cost).toBe(0.0001);
    });

    it("should set tokens_estimated to true when any span has tokens_estimated", () => {
      const spans: Span[] = [
        {
          trace_id: "trace_1",
          span_id: "span_1",
          type: "llm",
          name: "LLM Call",
          timestamps: {
            started_at: 1000,
            finished_at: 2000,
          },
          metrics: {
            cost: 0.0001,
            tokens_estimated: true,
          },
        },
        {
          trace_id: "trace_1",
          span_id: "span_2",
          type: "llm",
          name: "Another LLM Call",
          timestamps: {
            started_at: 1500,
            finished_at: 2500,
          },
          metrics: {
            cost: 0.0002,
            tokens_estimated: false,
          },
        },
      ];

      const metrics = computeTraceMetrics(spans);

      expect(metrics!.tokens_estimated).toBe(true);
      expect(metrics!.total_cost).toBeCloseTo(0.0003, 10);
    });
  });

  describe("addLLMTokensCount", () => {
    it("calculates cost correctly when number of tokens is available", async () => {
      const spans: Span[] = [
        {
          trace_id: "trace_1",
          span_id: "span_1",
          type: "llm",
          model: "gpt-4o-mini",
          input: {
            type: "text",
            value: "Hello, world!",
          },
          output: {
            type: "text",
            value: "Hello, world!",
          },
          timestamps: {
            started_at: Date.now(),
            finished_at: Date.now() + 1000,
          },
          metrics: {
            prompt_tokens: 200,
            completion_tokens: 100,
          },
        },
      ];

      const [span] = await addLLMTokensCount("project_abc", spans);

      const gpt4oMiniInputCost = 0.00015;
      const gpt4oMiniOutputCost = 0.0006;

      expect(span).toBeTruthy();
      expect(span!.metrics).toBeTruthy();
      expect(span!.metrics!.cost).toEqual(
        (gpt4oMiniInputCost * 200) / 1000 + (gpt4oMiniOutputCost * 100) / 1000
      );
    });

    it("should estimate tokens and calculate cost when tokens are not provided", async () => {
      const spans: Span[] = [
        {
          trace_id: "trace_1",
          span_id: "span_1",
          type: "llm",
          model: "gpt-4o-mini",
          input: {
            type: "text",
            value: "Hello, world!",
          },
          output: {
            type: "text",
            value: "Hello, world!",
          },
          timestamps: {
            started_at: Date.now(),
            finished_at: Date.now() + 1000,
          },
          // No metrics - should be estimated
        },
      ];

      const [span] = await addLLMTokensCount("project_abc", spans);

      expect(span).toBeTruthy();
      expect(span!.metrics).toBeTruthy();
      expect(span!.metrics!.prompt_tokens).toBe(100); // From mock
      expect(span!.metrics!.completion_tokens).toBe(50); // From mock
      expect(span!.metrics!.tokens_estimated).toBe(true);
      expect(span!.metrics!.cost).toBeDefined();
    });

    it("should not modify non-LLM spans", async () => {
      const spans: Span[] = [
        {
          trace_id: "trace_1",
          span_id: "span_1",
          type: "span",
          name: "Processing",
          timestamps: {
            started_at: Date.now(),
            finished_at: Date.now() + 1000,
          },
          // No metrics
        },
      ];

      const [span] = await addLLMTokensCount("project_abc", spans);

      expect(span).toBeTruthy();
      expect(span!.metrics).toBeUndefined();
    });
  });

  describe("addGuardrailCosts", () => {
    it("should add cost from guardrail result", () => {
      const spans: Span[] = [
        {
          trace_id: "trace_1",
          span_id: "span_1",
          type: "span",
          name: "Guardrail Check",
          timestamps: {
            started_at: Date.now(),
            finished_at: Date.now() + 1000,
          },
          output: {
            type: "guardrail_result",
            value: {
              status: "processed",
              cost: {
                amount: 0.0005,
                currency: "USD",
              },
            },
          },
        },
      ];

      const result = addGuardrailCosts(spans);

      expect(result[0]!.metrics).toBeDefined();
      expect(result[0]!.metrics!.cost).toBe(0.0005);
    });

    it("should not add cost when no guardrail result", () => {
      const spans: Span[] = [
        {
          trace_id: "trace_1",
          span_id: "span_1",
          type: "span",
          name: "Regular Span",
          timestamps: {
            started_at: Date.now(),
            finished_at: Date.now() + 1000,
          },
          output: {
            type: "text",
            value: "Regular output",
          },
        },
      ];

      const result = addGuardrailCosts(spans);

      expect(result[0]!.metrics).toBeUndefined();
    });

    it("should warn for non-USD currency", () => {
      const spans: Span[] = [
        {
          trace_id: "trace_1",
          span_id: "span_1",
          type: "span",
          name: "Guardrail Check",
          timestamps: {
            started_at: Date.now(),
            finished_at: Date.now() + 1000,
          },
          output: {
            type: "guardrail_result",
            value: {
              status: "processed",
              cost: {
                amount: 0.0005,
                currency: "EUR",
              },
            },
          },
        },
      ];

      addGuardrailCosts(spans);

      // Verify the cost is still added despite the warning
      expect(spans[0]!.metrics?.cost).toBe(0.0005);
    });
  });
});
