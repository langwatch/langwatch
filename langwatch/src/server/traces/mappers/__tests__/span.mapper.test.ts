import { describe, it, expect } from "vitest";
import { mapNormalizedSpanToSpan, unflattenDotNotation } from "../span.mapper";
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
  describe("when params contain dot-notation keys", () => {
    it("converts dot-notation keys to nested objects", () => {
      const span = makeSpan({
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.usage.input_tokens": 100,
          "mastra.span.type": "model_step",
        },
      });

      const result = mapNormalizedSpanToSpan(span);

      const params = result.params as Record<string, unknown>;
      expect((params.gen_ai as Record<string, unknown>).usage).toEqual({
        input_tokens: 100,
      });
      expect((params.mastra as Record<string, unknown>).span).toEqual({
        type: "model_step",
      });
    });

    it("preserves complex leaf values (arrays, objects)", () => {
      const span = makeSpan({
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.input.messages": [
            { role: "user", content: "hello" },
          ],
        },
      });

      const result = mapNormalizedSpanToSpan(span);

      const params = result.params as Record<string, unknown>;
      expect(
        ((params.gen_ai as Record<string, unknown>).input as Record<string, unknown>)
          .messages,
      ).toEqual([{ role: "user", content: "hello" }]);
    });

    it("keeps keys without dots at top level", () => {
      const span = makeSpan({
        spanAttributes: {
          "langwatch.span.type": "span",
          "simple_key": "value",
        },
      });

      const result = mapNormalizedSpanToSpan(span);

      const params = result.params as Record<string, unknown>;
      expect(params.simple_key).toBe("value");
    });
  });

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

    it("coerces string token values to numbers", () => {
      const span = makeSpan({
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.usage.input_tokens": "100",
          "gen_ai.usage.output_tokens": "50",
          "gen_ai.usage.reasoning_tokens": "720",
        },
      });

      const result = mapNormalizedSpanToSpan(span);

      expect(result.metrics).toEqual({
        prompt_tokens: 100,
        completion_tokens: 50,
        reasoning_tokens: 720,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
        cost: null,
        tokens_estimated: null,
      });
    });

    it("reads Mastra non-standard cached_input_tokens as fallback", () => {
      const span = makeSpan({
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.cached_input_tokens": "150",
        },
      });

      const result = mapNormalizedSpanToSpan(span);

      expect(result.metrics?.cache_read_input_tokens).toBe(150);
    });

    it("prefers canonical cache_read.input_tokens over Mastra fallback", () => {
      const span = makeSpan({
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.cache_read.input_tokens": 200,
          "gen_ai.usage.cached_input_tokens": "150",
        },
      });

      const result = mapNormalizedSpanToSpan(span);

      expect(result.metrics?.cache_read_input_tokens).toBe(200);
    });
  });
});

describe("unflattenDotNotation", () => {
  describe("when given single-level keys", () => {
    it("keeps them at top level", () => {
      const result = unflattenDotNotation({ simple: "value", count: 42 });
      expect(result).toEqual({ simple: "value", count: 42 });
    });
  });

  describe("when given dotted keys", () => {
    it("nests them into objects", () => {
      const result = unflattenDotNotation({
        "a.b.c": 1,
        "a.b.d": 2,
        "x.y": "z",
      });
      expect(result).toEqual({
        a: { b: { c: 1, d: 2 } },
        x: { y: "z" },
      });
    });
  });

  describe("when paths conflict with existing values", () => {
    it("overwrites scalar intermediate values with objects", () => {
      const result = unflattenDotNotation({
        "a.b": "scalar",
        "a.b.c": "deep",
      });
      expect(result.a).toEqual({ b: { c: "deep" } });
    });
  });

  describe("when keys contain prototype pollution attempts", () => {
    it("skips __proto__ keys", () => {
      const result = unflattenDotNotation({
        "__proto__.polluted": "yes",
        safe: "ok",
      });
      expect(result.safe).toBe("ok");
      expect(result.polluted).toBeUndefined();
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });

    it("skips constructor keys", () => {
      const result = unflattenDotNotation({
        "constructor.prototype.polluted": "yes",
        safe: "ok",
      });
      expect(result.safe).toBe("ok");
      expect((result as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("skips prototype keys", () => {
      const result = unflattenDotNotation({
        "prototype.evil": "yes",
        safe: "ok",
      });
      expect(result.safe).toBe("ok");
      expect(Object.keys(result)).toEqual(["safe"]);
    });

    it("skips dangerous keys at leaf position", () => {
      const result = unflattenDotNotation({
        "a.__proto__": "bad",
        "a.ok": "good",
      });
      expect(result).toEqual({ a: { ok: "good" } });
    });
  });

  describe("when given empty input", () => {
    it("returns an empty object", () => {
      const result = unflattenDotNotation({});
      expect(result).toEqual({});
    });
  });
});
