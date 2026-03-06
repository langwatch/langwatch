import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  OtlpSpanTokenEstimationService,
  type OtlpSpanTokenEstimationServiceDependencies,
} from "../span-token-estimation.service";

function createTestSpan(
  attributes: Array<{
    key: string;
    value: {
      stringValue?: string;
      intValue?: number;
      doubleValue?: number;
      boolValue?: boolean;
    };
  }> = [],
): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "test-span",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 1000000, high: 0 },
    attributes,
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

function createMockDeps(): OtlpSpanTokenEstimationServiceDependencies {
  return {
    tokenizer: {
      countTokens: vi.fn(async (_model: string, text: string | undefined) => {
        if (!text) return undefined;
        // Simple mock: ~4 chars per token (rough approximation)
        return Math.ceil(text.length / 4);
      }),
    },
  };
}

describe("OtlpSpanTokenEstimationService", () => {
  let deps: OtlpSpanTokenEstimationServiceDependencies;
  let service: OtlpSpanTokenEstimationService;

  beforeEach(() => {
    deps = createMockDeps();
    service = new OtlpSpanTokenEstimationService(deps);
  });

  describe("estimateSpanTokens", () => {
    describe("when span is an LLM span with input/output but no token counts", () => {
      it("estimates tokens from langwatch.input chat_messages and pushes attributes", async () => {
        const span = createTestSpan([
          {
            key: "langwatch.span.type",
            value: { stringValue: "llm" },
          },
          {
            key: "gen_ai.request.model",
            value: { stringValue: "gpt-4o-mini" },
          },
          {
            key: "langwatch.input",
            value: {
              stringValue: JSON.stringify({
                type: "chat_messages",
                value: [
                  { role: "system", content: "You are a helpful assistant." },
                  { role: "user", content: "Hello!" },
                ],
              }),
            },
          },
          {
            key: "langwatch.output",
            value: {
              stringValue: JSON.stringify([
                { role: "assistant", content: "Hi there, how can I help?" },
              ]),
            },
          },
        ]);

        await service.estimateSpanTokens(span);

        const inputTokensAttr = span.attributes.find(
          (a) => a.key === "gen_ai.usage.input_tokens",
        );
        const outputTokensAttr = span.attributes.find(
          (a) => a.key === "gen_ai.usage.output_tokens",
        );
        const estimatedAttr = span.attributes.find(
          (a) => a.key === "langwatch.tokens.estimated",
        );

        expect(inputTokensAttr).toBeDefined();
        expect(inputTokensAttr!.value.intValue).toBeGreaterThan(0);
        expect(outputTokensAttr).toBeDefined();
        expect(outputTokensAttr!.value.intValue).toBeGreaterThan(0);
        expect(estimatedAttr).toBeDefined();
        expect(estimatedAttr!.value.boolValue).toBe(true);
      });

      it("estimates tokens from gen_ai.input/output.messages", async () => {
        const span = createTestSpan([
          {
            key: "langwatch.span.type",
            value: { stringValue: "llm" },
          },
          {
            key: "gen_ai.request.model",
            value: { stringValue: "gpt-4o" },
          },
          {
            key: "gen_ai.input.messages",
            value: {
              stringValue: JSON.stringify([
                { role: "user", content: "What is 2+2?" },
              ]),
            },
          },
          {
            key: "gen_ai.output.messages",
            value: {
              stringValue: JSON.stringify([
                { role: "assistant", content: "4" },
              ]),
            },
          },
        ]);

        await service.estimateSpanTokens(span);

        const inputTokensAttr = span.attributes.find(
          (a) => a.key === "gen_ai.usage.input_tokens",
        );
        const outputTokensAttr = span.attributes.find(
          (a) => a.key === "gen_ai.usage.output_tokens",
        );

        expect(inputTokensAttr).toBeDefined();
        expect(inputTokensAttr!.value.intValue).toBeGreaterThan(0);
        expect(outputTokensAttr).toBeDefined();
        expect(outputTokensAttr!.value.intValue).toBeGreaterThan(0);
      });
    });

    describe("when span already has token counts", () => {
      it("does not re-estimate", async () => {
        const span = createTestSpan([
          {
            key: "langwatch.span.type",
            value: { stringValue: "llm" },
          },
          {
            key: "gen_ai.request.model",
            value: { stringValue: "gpt-4o-mini" },
          },
          {
            key: "gen_ai.usage.input_tokens",
            value: { intValue: 42 },
          },
          {
            key: "gen_ai.usage.output_tokens",
            value: { intValue: 17 },
          },
          {
            key: "langwatch.input",
            value: {
              stringValue: JSON.stringify({
                type: "chat_messages",
                value: [{ role: "user", content: "Hello!" }],
              }),
            },
          },
        ]);

        const originalAttrCount = span.attributes.length;
        await service.estimateSpanTokens(span);

        // No new attributes should be pushed
        expect(span.attributes.length).toBe(originalAttrCount);
        expect(deps.tokenizer.countTokens).not.toHaveBeenCalled();
      });
    });

    describe("when span has only input tokens but no output tokens", () => {
      it("estimates only the missing output tokens", async () => {
        const span = createTestSpan([
          {
            key: "langwatch.span.type",
            value: { stringValue: "llm" },
          },
          {
            key: "gen_ai.request.model",
            value: { stringValue: "gpt-4o-mini" },
          },
          {
            key: "gen_ai.usage.input_tokens",
            value: { intValue: 42 },
          },
          {
            key: "langwatch.output",
            value: {
              stringValue: JSON.stringify([
                { role: "assistant", content: "Response text" },
              ]),
            },
          },
        ]);

        await service.estimateSpanTokens(span);

        const outputTokensAttr = span.attributes.find(
          (a) => a.key === "gen_ai.usage.output_tokens",
        );
        expect(outputTokensAttr).toBeDefined();
        expect(outputTokensAttr!.value.intValue).toBeGreaterThan(0);

        // Should not have added a duplicate input tokens attr
        const inputTokensAttrs = span.attributes.filter(
          (a) => a.key === "gen_ai.usage.input_tokens",
        );
        expect(inputTokensAttrs).toHaveLength(1);
        expect(inputTokensAttrs[0]!.value.intValue).toBe(42);
      });
    });

    describe("when span is not an LLM type", () => {
      it("does not estimate tokens", async () => {
        const span = createTestSpan([
          {
            key: "langwatch.span.type",
            value: { stringValue: "tool" },
          },
          {
            key: "gen_ai.request.model",
            value: { stringValue: "gpt-4o-mini" },
          },
          {
            key: "langwatch.input",
            value: { stringValue: "some input" },
          },
        ]);

        const originalAttrCount = span.attributes.length;
        await service.estimateSpanTokens(span);

        expect(span.attributes.length).toBe(originalAttrCount);
        expect(deps.tokenizer.countTokens).not.toHaveBeenCalled();
      });
    });

    describe("when span has no langwatch.span.type attribute", () => {
      it("does not estimate tokens", async () => {
        const span = createTestSpan([
          {
            key: "gen_ai.request.model",
            value: { stringValue: "gpt-4o-mini" },
          },
          {
            key: "langwatch.input",
            value: {
              stringValue: JSON.stringify({
                type: "chat_messages",
                value: [{ role: "user", content: "Hello" }],
              }),
            },
          },
        ]);

        const originalAttrCount = span.attributes.length;
        await service.estimateSpanTokens(span);

        expect(span.attributes.length).toBe(originalAttrCount);
      });
    });

    describe("when span has no model attribute", () => {
      it("does not estimate tokens", async () => {
        const span = createTestSpan([
          {
            key: "langwatch.span.type",
            value: { stringValue: "llm" },
          },
          {
            key: "langwatch.input",
            value: {
              stringValue: JSON.stringify({
                type: "chat_messages",
                value: [{ role: "user", content: "Hello" }],
              }),
            },
          },
        ]);

        const originalAttrCount = span.attributes.length;
        await service.estimateSpanTokens(span);

        expect(span.attributes.length).toBe(originalAttrCount);
      });
    });

    describe("when span has no input/output content", () => {
      it("does not estimate tokens", async () => {
        const span = createTestSpan([
          {
            key: "langwatch.span.type",
            value: { stringValue: "llm" },
          },
          {
            key: "gen_ai.request.model",
            value: { stringValue: "gpt-4o-mini" },
          },
        ]);

        const originalAttrCount = span.attributes.length;
        await service.estimateSpanTokens(span);

        expect(span.attributes.length).toBe(originalAttrCount);
      });
    });

    describe("when tokenizer returns undefined", () => {
      it("does not push token attributes", async () => {
        deps.tokenizer.countTokens = vi.fn(async () => undefined);
        service = new OtlpSpanTokenEstimationService(deps);

        const span = createTestSpan([
          {
            key: "langwatch.span.type",
            value: { stringValue: "llm" },
          },
          {
            key: "gen_ai.request.model",
            value: { stringValue: "unknown-model-xyz" },
          },
          {
            key: "langwatch.input",
            value: {
              stringValue: JSON.stringify({
                type: "chat_messages",
                value: [{ role: "user", content: "Hello" }],
              }),
            },
          },
        ]);

        const originalAttrCount = span.attributes.length;
        await service.estimateSpanTokens(span);

        expect(span.attributes.length).toBe(originalAttrCount);
      });
    });

    describe("when span has prompt_tokens (legacy key)", () => {
      it("recognizes them and does not re-estimate input tokens", async () => {
        const span = createTestSpan([
          {
            key: "langwatch.span.type",
            value: { stringValue: "llm" },
          },
          {
            key: "gen_ai.request.model",
            value: { stringValue: "gpt-4o-mini" },
          },
          {
            key: "gen_ai.usage.prompt_tokens",
            value: { intValue: 100 },
          },
          {
            key: "gen_ai.usage.completion_tokens",
            value: { intValue: 50 },
          },
          {
            key: "langwatch.input",
            value: {
              stringValue: JSON.stringify({
                type: "chat_messages",
                value: [{ role: "user", content: "Hello" }],
              }),
            },
          },
        ]);

        const originalAttrCount = span.attributes.length;
        await service.estimateSpanTokens(span);

        expect(span.attributes.length).toBe(originalAttrCount);
        expect(deps.tokenizer.countTokens).not.toHaveBeenCalled();
      });
    });

    describe("when langwatch.input has text type", () => {
      it("extracts text value for tokenization", async () => {
        const span = createTestSpan([
          {
            key: "langwatch.span.type",
            value: { stringValue: "llm" },
          },
          {
            key: "gen_ai.request.model",
            value: { stringValue: "gpt-4o-mini" },
          },
          {
            key: "langwatch.input",
            value: {
              stringValue: JSON.stringify({
                type: "text",
                value: "What is the meaning of life?",
              }),
            },
          },
          {
            key: "langwatch.output",
            value: {
              stringValue: JSON.stringify({
                type: "text",
                value: "42",
              }),
            },
          },
        ]);

        await service.estimateSpanTokens(span);

        expect(deps.tokenizer.countTokens).toHaveBeenCalledWith(
          "gpt-4o-mini",
          "What is the meaning of life?",
        );
        expect(deps.tokenizer.countTokens).toHaveBeenCalledWith(
          "gpt-4o-mini",
          "42",
        );
      });
    });
  });
});
