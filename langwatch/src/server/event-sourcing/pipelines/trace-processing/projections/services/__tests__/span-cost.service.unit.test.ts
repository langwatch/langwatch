import { describe, expect, it } from "vitest";

import { NormalizedSpanKind } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";

import { SpanCostService } from "../span-cost.service";

function makeSpan(overrides: Partial<NormalizedSpan> = {}): NormalizedSpan {
  return {
    id: "test-id",
    traceId: "trace-123",
    spanId: "span-456",
    tenantId: "tenant-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 10_000,
    endTimeUnixMs: 12_000,
    durationMs: 2000,
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
    cost: null,
    nonBilledCost: null,
    ...overrides,
  };
}

describe("SpanCostService.extractTokenTiming", () => {
  const service = new SpanCostService();

  describe("when the span carries first-token stream events", () => {
    it("derives TTFT from the earliest first-token event", () => {
      const span = makeSpan({
        events: [
          { name: "gen_ai.content.chunk", timeUnixMs: 10_500, attributes: {} },
          { name: "gen_ai.content.chunk", timeUnixMs: 11_000, attributes: {} },
        ],
      });

      const timing = service.extractTokenTiming(span);

      expect(timing.timeToFirstToken).toBe(500);
    });

    it("prefers stream events over the langwatch.timestamps attribute", () => {
      const span = makeSpan({
        events: [
          { name: "gen_ai.content.chunk", timeUnixMs: 10_500, attributes: {} },
        ],
        spanAttributes: {
          "langwatch.timestamps": { first_token_at: 10_800 },
        },
      });

      const timing = service.extractTokenTiming(span);

      expect(timing.timeToFirstToken).toBe(500);
    });
  });

  describe("when the span carries the gen_ai.server.time_to_first_token attribute", () => {
    it("uses the attribute value as a millisecond duration", () => {
      const span = makeSpan({
        spanAttributes: { "gen_ai.server.time_to_first_token": 320 },
      });

      const timing = service.extractTokenTiming(span);

      expect(timing.timeToFirstToken).toBe(320);
    });
  });

  describe("when the span carries only the langwatch.timestamps attribute", () => {
    it("derives TTFT from first_token_at relative to the span start", () => {
      const span = makeSpan({
        spanAttributes: {
          "langwatch.timestamps": {
            started_at: 10_000,
            first_token_at: 10_800,
            finished_at: 12_000,
          },
        },
      });

      const timing = service.extractTokenTiming(span);

      expect(timing.timeToFirstToken).toBe(800);
    });

    it("accepts a raw JSON string value", () => {
      const span = makeSpan({
        spanAttributes: {
          "langwatch.timestamps": JSON.stringify({ first_token_at: 10_650 }),
        },
      });

      const timing = service.extractTokenTiming(span);

      expect(timing.timeToFirstToken).toBe(650);
    });

    it("ignores a first_token_at earlier than the span start", () => {
      const span = makeSpan({
        spanAttributes: {
          "langwatch.timestamps": { first_token_at: 9_000 },
        },
      });

      const timing = service.extractTokenTiming(span);

      expect(timing.timeToFirstToken).toBeNull();
    });

    it("ignores malformed payloads", () => {
      const span = makeSpan({
        spanAttributes: {
          "langwatch.timestamps": "not-json",
        },
      });

      const timing = service.extractTokenTiming(span);

      expect(timing.timeToFirstToken).toBeNull();
    });
  });

  describe("when the span has no timing signals", () => {
    it("returns null TTFT", () => {
      const timing = service.extractTokenTiming(makeSpan());

      expect(timing.timeToFirstToken).toBeNull();
      expect(timing.timeToLastToken).toBeNull();
    });
  });
});
