import { describe, expect, it, vi } from "vitest";
import type { LLMSpan } from "../../../../tracer/types";
import { addLLMTokensCount } from "../metrics";

vi.mock("../../../../modelProviders/llmModelCost", () => ({
  getLLMModelCosts: vi.fn().mockResolvedValue([
    {
      projectId: "",
      model: "openai/gpt-4o",
      regex: "^(openai\\/)?gpt-4o$",
      inputCostPerToken: 0.0000025,
      outputCostPerToken: 0.00001,
    },
  ]),
}));

function makeLLMSpan(overrides: Partial<LLMSpan> = {}): LLMSpan {
  return {
    span_id: "span-1",
    trace_id: "trace-1",
    type: "llm",
    timestamps: { started_at: 0, finished_at: 1 },
    input: { type: "text", value: "hello world" },
    output: { type: "text", value: "hi there" },
    model: "gpt-4o",
    ...overrides,
  };
}

describe("addLLMTokensCount", () => {
  describe("when model matches a known cost entry", () => {
    it("estimates token counts and sets cost", async () => {
      const span = makeLLMSpan({ model: "gpt-4o" });
      await addLLMTokensCount("project-1", [span]);

      expect(span.metrics?.prompt_tokens).toBeGreaterThan(0);
      expect(span.metrics?.completion_tokens).toBeGreaterThan(0);
      expect(span.metrics?.cost).toBeDefined();
      expect(span.metrics?.cost).toBeGreaterThan(0);
      expect(span.metrics?.tokens_estimated).toBe(true);
    });
  });

  describe("when model does not match any cost entry", () => {
    it("estimates token counts using fallback tokenizer", async () => {
      const span = makeLLMSpan({ model: "unknown-model-xyz" });
      await addLLMTokensCount("project-1", [span]);

      expect(span.metrics?.prompt_tokens).toBeGreaterThan(0);
      expect(span.metrics?.completion_tokens).toBeGreaterThan(0);
      expect(span.metrics?.tokens_estimated).toBe(true);
    });

    it("does not set cost for unknown models", async () => {
      const span = makeLLMSpan({ model: "unknown-model-xyz" });
      await addLLMTokensCount("project-1", [span]);

      expect(span.metrics?.cost).toBeUndefined();
    });
  });

  describe("when tokens are already present", () => {
    it("does not overwrite existing prompt_tokens", async () => {
      const span = makeLLMSpan({ model: "gpt-4o" });
      span.metrics = { prompt_tokens: 42 };
      await addLLMTokensCount("project-1", [span]);

      expect(span.metrics.prompt_tokens).toBe(42);
    });

    it("does not overwrite existing completion_tokens", async () => {
      const span = makeLLMSpan({ model: "gpt-4o" });
      span.metrics = { completion_tokens: 99 };
      await addLLMTokensCount("project-1", [span]);

      expect(span.metrics.completion_tokens).toBe(99);
    });
  });

  describe("when span has no input or output", () => {
    it("skips tokenization for missing input", async () => {
      const span = makeLLMSpan({ model: "gpt-4o", input: null });
      await addLLMTokensCount("project-1", [span]);

      expect(span.metrics?.prompt_tokens).toBeUndefined();
    });

    it("skips tokenization for missing output", async () => {
      const span = makeLLMSpan({ model: "gpt-4o", output: null });
      await addLLMTokensCount("project-1", [span]);

      expect(span.metrics?.completion_tokens).toBeUndefined();
    });
  });

  describe("when span is not an LLM type", () => {
    it("does not add metrics to non-LLM spans", async () => {
      const span = {
        span_id: "span-1",
        trace_id: "trace-1",
        type: "rag" as const,
        timestamps: { started_at: 0, finished_at: 1 },
        contexts: [],
      };
      await addLLMTokensCount("project-1", [span]);

      expect(span).not.toHaveProperty("metrics");
    });
  });
});
