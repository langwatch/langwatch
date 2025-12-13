import { describe, expect, it } from "vitest";
import type { SpanData } from "../../schemas/commands";
import { traceAggregationService } from "../traceAggregationService";

function createSpan(
  spanId: string,
  attributes: Record<string, any> = {},
  options: {
    parentSpanId?: string | null;
    startTimeUnixMs?: number;
    endTimeUnixMs?: number;
    statusCode?: number;
    statusMessage?: string | null;
    events?: Array<{
      name: string;
      timeUnixMs: number;
      attributes: Record<string, any>;
    }>;
  } = {},
): SpanData {
  return {
    id: `span:${spanId}`,
    aggregateId: "trace:test",
    tenantId: "project_test",
    traceId: "test-trace-id",
    spanId,
    traceFlags: 0,
    traceState: null,
    isRemote: false,
    parentSpanId: options.parentSpanId ?? null,
    name: "test-span",
    kind: 1,
    startTimeUnixMs: options.startTimeUnixMs ?? 1000,
    endTimeUnixMs: options.endTimeUnixMs ?? 2000,
    attributes,
    events: options.events ?? [],
    links: [],
    status: {
      code: options.statusCode ?? 1,
      message: options.statusMessage ?? null,
    },
    resourceAttributes: {
      "service.name": "test-service",
    },
    instrumentationScope: { name: "test", version: null },
    durationMs:
      (options.endTimeUnixMs ?? 2000) - (options.startTimeUnixMs ?? 1000),
    ended: true,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

describe("TraceAggregationService", () => {
  describe("aggregateTrace", () => {
    describe("when aggregating basic span metrics", () => {
      it("calculates total spans", () => {
        const spans = [
          createSpan("span1"),
          createSpan("span2", {}, { parentSpanId: "span1" }),
          createSpan("span3", {}, { parentSpanId: "span1" }),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.totalSpans).toBe(3);
        expect(result.spanIds).toEqual(["span1", "span2", "span3"]);
      });

      it("calculates duration from start to end times", () => {
        const spans = [
          createSpan(
            "span1",
            {},
            { startTimeUnixMs: 1000, endTimeUnixMs: 2000 },
          ),
          createSpan(
            "span2",
            {},
            { startTimeUnixMs: 1500, endTimeUnixMs: 3000 },
          ),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.startTimeUnixMs).toBe(1000);
        expect(result.endTimeUnixMs).toBe(3000);
        expect(result.durationMs).toBe(2000);
      });

      it("identifies root span", () => {
        const spans = [
          createSpan("root"),
          createSpan("child", {}, { parentSpanId: "root" }),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.rootSpanId).toBe("root");
      });

      it("extracts service names", () => {
        const spans = [
          {
            ...createSpan("span1"),
            resourceAttributes: { "service.name": "api-service" },
          },
          {
            ...createSpan("span2"),
            resourceAttributes: { "service.name": "llm-service" },
          },
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.serviceNames).toEqual(["api-service", "llm-service"]);
      });
    });

    describe("when extracting token counts", () => {
      it("sums gen_ai.usage.input_tokens", () => {
        const spans = [
          createSpan("span1", { "gen_ai.usage.input_tokens": 100 }),
          createSpan("span2", { "gen_ai.usage.input_tokens": 50 }),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.TotalPromptTokenCount).toBe(150);
      });

      it("sums gen_ai.usage.output_tokens", () => {
        const spans = [
          createSpan("span1", { "gen_ai.usage.output_tokens": 200 }),
          createSpan("span2", { "gen_ai.usage.output_tokens": 100 }),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.TotalCompletionTokenCount).toBe(300);
      });

      it("handles legacy llm.prompt_tokens and llm.completion_tokens", () => {
        const spans = [
          createSpan("span1", {
            "llm.prompt_tokens": 75,
            "llm.completion_tokens": 150,
          }),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.TotalPromptTokenCount).toBe(75);
        expect(result.TotalCompletionTokenCount).toBe(150);
      });

      it("calculates tokens per second", () => {
        const spans = [
          createSpan(
            "span1",
            { "gen_ai.usage.output_tokens": 1000 },
            { startTimeUnixMs: 1000, endTimeUnixMs: 2000 },
          ),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.TokensPerSecond).toBe(1000);
      });
    });

    describe("when extracting models", () => {
      it("extracts from gen_ai.response.model", () => {
        const spans = [
          createSpan("span1", { "gen_ai.response.model": "gpt-4" }),
          createSpan("span2", { "gen_ai.response.model": "gpt-3.5-turbo" }),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.Models).toEqual(["gpt-3.5-turbo", "gpt-4"]);
      });

      it("extracts from gen_ai.request.model", () => {
        const spans = [
          createSpan("span1", { "gen_ai.request.model": "claude-3" }),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.Models).toContain("claude-3");
      });

      it("handles legacy model attribute", () => {
        const spans = [createSpan("span1", { model: "gpt-4-turbo" })];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.Models).toContain("gpt-4-turbo");
      });
    });

    describe("when handling error status", () => {
      it("detects OK status", () => {
        const spans = [createSpan("span1", {}, { statusCode: 1 })];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.ContainsOKStatus).toBe(true);
        expect(result.ContainsErrorStatus).toBe(false);
      });

      it("detects ERROR status", () => {
        const spans = [
          createSpan(
            "span1",
            {},
            { statusCode: 2, statusMessage: "API error" },
          ),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.ContainsErrorStatus).toBe(true);
        expect(result.ErrorMessage).toBe("API error");
      });
    });

    describe("when calculating time to first token", () => {
      it("extracts from gen_ai.content.chunk event", () => {
        const spans = [
          createSpan(
            "span1",
            {},
            {
              startTimeUnixMs: 1000,
              events: [
                {
                  name: "gen_ai.content.chunk",
                  timeUnixMs: 1500,
                  attributes: {},
                },
              ],
            },
          ),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.TimeToFirstTokenMs).toBe(500);
      });

      it("extracts from first_token event", () => {
        const spans = [
          createSpan(
            "span1",
            {},
            {
              startTimeUnixMs: 1000,
              events: [
                {
                  name: "first_token",
                  timeUnixMs: 1200,
                  attributes: {},
                },
              ],
            },
          ),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.TimeToFirstTokenMs).toBe(200);
      });
    });

    describe("when extracting cost", () => {
      it("sums langwatch.span.cost", () => {
        const spans = [
          createSpan("span1", { "langwatch.span.cost": 0.001 }),
          createSpan("span2", { "langwatch.span.cost": 0.002 }),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.TotalCost).toBe(0.003);
      });

      it("sets TokensEstimated flag", () => {
        const spans = [
          createSpan("span1", {
            "langwatch.tokens.estimated": true,
          }),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.TokensEstimated).toBe(true);
      });
    });

    describe("when handling invalid timestamps", () => {
      it("filters out spans with invalid timestamps", () => {
        const spans = [
          createSpan(
            "span1",
            {},
            { startTimeUnixMs: 1000, endTimeUnixMs: 2000 },
          ),
          createSpan("span2", {}, { startTimeUnixMs: 0, endTimeUnixMs: 0 }),
          createSpan(
            "span3",
            {},
            { startTimeUnixMs: 3000, endTimeUnixMs: 4000 },
          ),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.startTimeUnixMs).toBe(1000);
        expect(result.endTimeUnixMs).toBe(4000);
      });

      it("throws error when all spans have invalid timestamps", () => {
        const spans = [
          createSpan("span1", {}, { startTimeUnixMs: 0, endTimeUnixMs: 0 }),
          createSpan("span2", {}, { startTimeUnixMs: -1, endTimeUnixMs: -1 }),
        ];

        expect(() => traceAggregationService.aggregateTrace(spans)).toThrow(
          "Cannot aggregate trace: all spans have invalid timestamps",
        );
      });
    });

    describe("when extracting metadata", () => {
      it("extracts computed metadata", () => {
        const spans = [
          createSpan("span1", {
            "computed.custom_field": "value1",
            "metadata.another_field": "value2",
          }),
        ];

        const result = traceAggregationService.aggregateTrace(spans);

        expect(result.ComputedAttributes).toEqual({
          "computed.custom_field": "value1",
          "metadata.another_field": "value2",
        });
      });
    });
  });
});
