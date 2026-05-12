import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantId, type Command } from "../../../../";
import type { RecordSpanCommandData } from "../../schemas/commands";
import { RECORD_SPAN_COMMAND_TYPE } from "../../schemas/constants";
import type { OtlpSpan } from "../../schemas/otlp";
import {
  RecordSpanCommand,
  type RecordSpanCommandDependencies,
} from "../recordSpanCommand";

/**
 * Creates an OtlpSpan command matching the real trace data:
 * LLM span with chat_messages input/output, model, but no token counts.
 */
function createLlmSpanCommand({
  tenantId = "project-123",
  traceId = "trace-1",
  spanId = "span-1",
  model = "gpt-4o-mini",
  inputMessages = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Any advice on sleep?" },
  ],
  outputMessages = [
    { role: "assistant", content: "Here are some strategies." },
  ],
  existingTokenAttributes = [] as Array<{
    key: string;
    value: { intValue?: number; stringValue?: string };
  }>,
}: {
  tenantId?: string;
  traceId?: string;
  spanId?: string;
  model?: string;
  inputMessages?: Array<{ role: string; content: string }>;
  outputMessages?: Array<{ role: string; content: string }>;
  existingTokenAttributes?: Array<{
    key: string;
    value: { intValue?: number; stringValue?: string };
  }>;
} = {}): Command<RecordSpanCommandData> {
  return {
    type: RECORD_SPAN_COMMAND_TYPE,
    aggregateId: traceId,
    tenantId: createTenantId(tenantId),
    data: {
      tenantId,
      occurredAt: 1000000,
      span: {
        traceId,
        spanId,
        name: "chat gpt-4o-mini",
        kind: 1,
        startTimeUnixNano: { low: 0, high: 0 },
        endTimeUnixNano: { low: 1000000, high: 0 },
        attributes: [
          {
            key: "langwatch.span.type",
            value: { stringValue: "llm" },
          },
          {
            key: "gen_ai.request.model",
            value: { stringValue: model },
          },
          {
            key: "langwatch.input",
            value: {
              stringValue: JSON.stringify({
                type: "chat_messages",
                value: inputMessages,
              }),
            },
          },
          {
            key: "langwatch.output",
            value: {
              stringValue: JSON.stringify(outputMessages),
            },
          },
          ...existingTokenAttributes,
        ],
        events: [],
        links: [],
        status: {},
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: { attributes: [] },
      instrumentationScope: { name: "test-scope" },
    },
  };
}

function createDeps(): RecordSpanCommandDependencies {
  return {
    piiRedactionService: { redactSpan: vi.fn() },
    costEnrichmentService: { enrichSpan: vi.fn() },
    tokenEstimationService: {
      estimateSpanTokens: vi.fn(async ({ span }: { span: OtlpSpan }) => {
        // Simulate the real token estimation service behavior:
        // Check if this is an LLM span without token counts, estimate from input/output
        const isLlm = span.attributes.some(
          (a) =>
            a.key === "langwatch.span.type" && a.value.stringValue === "llm",
        );
        if (!isLlm) return;

        const hasInputTokens = span.attributes.some(
          (a) =>
            a.key === "gen_ai.usage.input_tokens" ||
            a.key === "gen_ai.usage.prompt_tokens",
        );
        const hasOutputTokens = span.attributes.some(
          (a) =>
            a.key === "gen_ai.usage.output_tokens" ||
            a.key === "gen_ai.usage.completion_tokens",
        );

        if (hasInputTokens && hasOutputTokens) return;

        // Push estimated tokens (simulate tiktoken counting)
        if (!hasInputTokens) {
          span.attributes.push({
            key: "gen_ai.usage.input_tokens",
            value: { intValue: 25 },
          });
        }
        if (!hasOutputTokens) {
          span.attributes.push({
            key: "gen_ai.usage.output_tokens",
            value: { intValue: 12 },
          });
        }
        span.attributes.push({
          key: "langwatch.tokens.estimated",
          value: { boolValue: true },
        });
      }),
    },
  };
}

describe("RecordSpanCommand token estimation", () => {
  let handler: RecordSpanCommand;
  let deps: RecordSpanCommandDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
    handler = new RecordSpanCommand(deps);
  });

  describe("when LLM span has input/output but no token counts", () => {
    it("calls token estimation service", async () => {
      const command = createLlmSpanCommand();

      await handler.handle(command);

      expect(deps.tokenEstimationService.estimateSpanTokens).toHaveBeenCalled();
    });

    it("emits event with estimated token attributes on the span", async () => {
      const command = createLlmSpanCommand();

      const events = await handler.handle(command);

      const emittedSpan = events[0]!.data.span;

      const inputTokensAttr = emittedSpan.attributes.find(
        (a) => a.key === "gen_ai.usage.input_tokens",
      );
      const outputTokensAttr = emittedSpan.attributes.find(
        (a) => a.key === "gen_ai.usage.output_tokens",
      );
      const estimatedAttr = emittedSpan.attributes.find(
        (a) => a.key === "langwatch.tokens.estimated",
      );

      expect(inputTokensAttr).toBeDefined();
      expect(inputTokensAttr!.value.intValue).toBe(25);
      expect(outputTokensAttr).toBeDefined();
      expect(outputTokensAttr!.value.intValue).toBe(12);
      expect(estimatedAttr).toBeDefined();
      expect(estimatedAttr!.value.boolValue).toBe(true);
    });
  });

  describe("when LLM span already has token counts", () => {
    it("token estimation service does not add duplicate attributes", async () => {
      const command = createLlmSpanCommand({
        existingTokenAttributes: [
          { key: "gen_ai.usage.input_tokens", value: { intValue: 100 } },
          { key: "gen_ai.usage.output_tokens", value: { intValue: 50 } },
        ],
      });

      const events = await handler.handle(command);

      const emittedSpan = events[0]!.data.span;

      // Should have exactly one of each token attribute (the existing ones)
      const inputTokensAttrs = emittedSpan.attributes.filter(
        (a) => a.key === "gen_ai.usage.input_tokens",
      );
      const outputTokensAttrs = emittedSpan.attributes.filter(
        (a) => a.key === "gen_ai.usage.output_tokens",
      );
      const estimatedAttrs = emittedSpan.attributes.filter(
        (a) => a.key === "langwatch.tokens.estimated",
      );

      expect(inputTokensAttrs).toHaveLength(1);
      expect(inputTokensAttrs[0]!.value.intValue).toBe(100);
      expect(outputTokensAttrs).toHaveLength(1);
      expect(outputTokensAttrs[0]!.value.intValue).toBe(50);
      expect(estimatedAttrs).toHaveLength(0);
    });
  });

  describe("when token estimation fails", () => {
    it("continues without tokens (non-critical)", async () => {
      deps.tokenEstimationService.estimateSpanTokens = vi
        .fn()
        .mockRejectedValue(new Error("tiktoken unavailable"));
      handler = new RecordSpanCommand(deps);

      const command = createLlmSpanCommand();
      const events = await handler.handle(command);

      // Should still emit the event, just without estimated tokens
      expect(events).toHaveLength(1);
      const emittedSpan = events[0]!.data.span;

      const estimatedAttr = emittedSpan.attributes.find(
        (a) => a.key === "langwatch.tokens.estimated",
      );
      expect(estimatedAttr).toBeUndefined();
    });
  });

  describe("when span is not an LLM type", () => {
    it("token estimation service is still called but does nothing", async () => {
      const command = createLlmSpanCommand();
      // Override span type to "tool"
      command.data.span.attributes[0] = {
        key: "langwatch.span.type",
        value: { stringValue: "tool" },
      };

      const events = await handler.handle(command);

      // Token estimation was called but should not have added attributes
      expect(deps.tokenEstimationService.estimateSpanTokens).toHaveBeenCalled();
      const emittedSpan = events[0]!.data.span;
      const estimatedAttr = emittedSpan.attributes.find(
        (a) => a.key === "langwatch.tokens.estimated",
      );
      expect(estimatedAttr).toBeUndefined();
    });
  });
});
