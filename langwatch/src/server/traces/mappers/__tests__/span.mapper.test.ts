import { describe, it, expect } from "vitest";
import { mapNormalizedSpanToSpan } from "../span.mapper";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";

const makeSpan = (
  overrides: Partial<NormalizedSpan> = {},
): NormalizedSpan => ({
  id: "test-id",
  traceId: "trace-123",
  spanId: "span-456",
  tenantId: "tenant-1",
  parentSpanId: null,
  parentTraceId: null,
  parentIsRemote: null,
  sampled: true,
  startTimeUnixMs: 1000,
  endTimeUnixMs: 2000,
  durationMs: 1000,
  name: "test-span",
  kind: NormalizedSpanKind.INTERNAL,
  resourceAttributes: {},
  spanAttributes: {},
  events: [],
  links: [],
  statusMessage: null,
  statusCode: null,
  instrumentationScope: { name: "test", version: null },
  droppedAttributesCount: 0 as 0,
  droppedEventsCount: 0 as 0,
  droppedLinksCount: 0 as 0,
  ...overrides,
});

describe("mapNormalizedSpanToSpan", () => {
  describe("when extracting metrics", () => {
    it("extracts cache_read and cache_creation tokens from OTEL semconv attributes", () => {
      const span = makeSpan({
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.usage.prompt_tokens": 100,
          "gen_ai.usage.completion_tokens": 50,
          "gen_ai.usage.cache_read.input_tokens": 150,
          "gen_ai.usage.cache_creation.input_tokens": 30,
        },
      });

      const result = mapNormalizedSpanToSpan(span);

      expect(result.metrics).toEqual({
        prompt_tokens: 100,
        completion_tokens: 50,
        reasoning_tokens: null,
        cache_read_input_tokens: 150,
        cache_creation_input_tokens: 30,
        cost: null,
        tokens_estimated: null,
      });
    });

    it("returns metrics when only cache tokens are present", () => {
      const span = makeSpan({
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.usage.cache_read.input_tokens": 200,
        },
      });

      const result = mapNormalizedSpanToSpan(span);

      expect(result.metrics).not.toBeNull();
      expect(result.metrics?.cache_read_input_tokens).toBe(200);
    });

    it("returns null metrics when no token attributes exist", () => {
      const span = makeSpan({
        spanAttributes: {
          "langwatch.span.type": "llm",
        },
      });

      const result = mapNormalizedSpanToSpan(span);

      expect(result.metrics).toBeNull();
    });
  });
});
