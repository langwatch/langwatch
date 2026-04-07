import { describe, it, expect } from "vitest";
import { extractEventsFromSpans } from "../trace-summary.mapper";
import type { Span } from "~/server/tracer/types";

function makeSpan(overrides: Partial<Span> = {}): Span {
  return {
    span_id: "span-1",
    parent_id: null,
    trace_id: "trace-1",
    type: "span",
    name: "test-span",
    input: null,
    output: null,
    error: null,
    timestamps: {
      started_at: 1000,
      finished_at: 2000,
      first_token_at: null,
    },
    metrics: null,
    params: {},
    ...overrides,
  };
}

describe("extractEventsFromSpans", () => {
  describe("when spans have no event attributes", () => {
    it("returns empty array", () => {
      const spans = [
        makeSpan({ params: { "langwatch.span.type": "llm" } }),
      ];

      const result = extractEventsFromSpans(spans, "project-1", "trace-1");

      expect(result).toEqual([]);
    });
  });

  describe("when a span has event.type in params", () => {
    it("extracts it as an Event", () => {
      const spans = [
        makeSpan({
          span_id: "event-span-1",
          params: {
            event: {
              type: "thumbs_up_down",
              metrics: { vote: "1" },
              details: { comment: "great response" },
            },
          },
        }),
      ];

      const result = extractEventsFromSpans(spans, "project-1", "trace-1");

      expect(result).toEqual([
        {
          event_id: "event-span-1",
          event_type: "thumbs_up_down",
          project_id: "project-1",
          trace_id: "trace-1",
          metrics: { vote: 1 },
          event_details: { comment: "great response" },
          timestamps: {
            started_at: 1000,
            inserted_at: 1000,
            updated_at: 2000,
          },
        },
      ]);
    });
  });

  describe("when multiple event spans exist alongside regular spans", () => {
    it("extracts only event spans", () => {
      const spans = [
        makeSpan({
          span_id: "regular-span",
          params: { "langwatch.span.type": "llm" },
        }),
        makeSpan({
          span_id: "event-1",
          params: {
            event: { type: "like", metrics: { value: "1" } },
          },
        }),
        makeSpan({
          span_id: "event-2",
          params: {
            event: { type: "test_thumbs_up", metrics: { vote: "0" } },
          },
        }),
      ];

      const result = extractEventsFromSpans(spans, "project-1", "trace-1");

      expect(result).toHaveLength(2);
      expect(result[0]!.event_type).toBe("like");
      expect(result[1]!.event_type).toBe("test_thumbs_up");
    });
  });

  describe("when event span has no metrics or details", () => {
    it("returns empty metrics and event_details", () => {
      const spans = [
        makeSpan({
          span_id: "event-span",
          params: { event: { type: "page_view" } },
        }),
      ];

      const result = extractEventsFromSpans(spans, "project-1", "trace-1");

      expect(result).toHaveLength(1);
      expect(result[0]!.metrics).toEqual({});
      expect(result[0]!.event_details).toEqual({});
    });
  });

  describe("when metric values are non-numeric", () => {
    it("skips non-finite metric values", () => {
      const spans = [
        makeSpan({
          span_id: "event-span",
          params: {
            event: {
              type: "test",
              metrics: { valid: "42", invalid: "not-a-number", inf: "Infinity" },
            },
          },
        }),
      ];

      const result = extractEventsFromSpans(spans, "project-1", "trace-1");

      expect(result[0]!.metrics).toEqual({ valid: 42 });
    });
  });

  describe("when finished_at differs from started_at", () => {
    it("uses finished_at for updated_at timestamp", () => {
      const spans = [
        makeSpan({
          span_id: "event-span",
          timestamps: {
            started_at: 5000,
            finished_at: 6000,
            first_token_at: null,
          },
          params: { event: { type: "test" } },
        }),
      ];

      const result = extractEventsFromSpans(spans, "project-1", "trace-1");

      expect(result[0]!.timestamps.updated_at).toBe(6000);
    });
  });
});
