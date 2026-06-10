import { describe, it, expect } from "vitest";
import {
  extractEventsFromSpans,
  mapTraceSummaryToTrace,
} from "../trace-summary.mapper";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
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

      const result = extractEventsFromSpans({ spans, projectId: "project-1", traceId: "trace-1" });

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

      const result = extractEventsFromSpans({ spans, projectId: "project-1", traceId: "trace-1" });

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

      const result = extractEventsFromSpans({ spans, projectId: "project-1", traceId: "trace-1" });

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

      const result = extractEventsFromSpans({ spans, projectId: "project-1", traceId: "trace-1" });

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

      const result = extractEventsFromSpans({ spans, projectId: "project-1", traceId: "trace-1" });

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

      const result = extractEventsFromSpans({ spans, projectId: "project-1", traceId: "trace-1" });

      expect(result[0]!.timestamps.updated_at).toBe(6000);
    });
  });
});

function makeSummary(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    spanCount: 1,
    totalDurationMs: 100,
    computedIOSchemaVersion: "v1",
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: true,
    outputSpanEndTimeMs: 2000,
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    attributes: {},
    occurredAt: 1000,
    createdAt: 1000,
    updatedAt: 2000,
    LastEventOccurredAt: 2000,
    ...overrides,
  } as TraceSummaryData;
}

describe("mapTraceSummaryToTrace — display-side single-key wrapper recursion", () => {
  describe("when computedOutput is a structured json wrapper with a single unknown key", () => {
    it("drills into the wrapper and returns the inner content as trace.output.value", () => {
      // Shape produced when the ingestion layer stores the raw
      // {type: "json", value: {data: {content: "..."}}} wrapper and the
      // display layer tries to resolve human-readable text.
      const summary = makeSummary({
        computedOutput: JSON.stringify({
          type: "json",
          value: { data: { content: "COMPANY_ANALYSIS", formatName: "s" } },
        }),
      });

      const trace = mapTraceSummaryToTrace(summary, [], "project-1");

      expect(trace.output?.value).toBe("COMPANY_ANALYSIS");
    });

    it("falls through to the raw computedOutput when no state-field matches", () => {
      // `{data: {foo: "bar"}}` has no state-object field to pull text from,
      // so display returns the stringified payload unchanged.
      const raw = JSON.stringify({
        type: "json",
        value: { data: { foo: "bar" } },
      });
      const summary = makeSummary({ computedOutput: raw });

      const trace = mapTraceSummaryToTrace(summary, [], "project-1");

      expect(trace.output?.value).toBe(raw);
    });

    it("does not infinite-loop on deeply nested single-key wrappers (depth cap)", () => {
      // Build a 100-deep wrapper with no known field anywhere. The cap must
      // bail out instead of stack-overflowing.
      let inner: Record<string, unknown> = {};
      for (let i = 0; i < 100; i++) {
        inner = { nested: inner };
      }
      const summary = makeSummary({
        computedOutput: JSON.stringify({ type: "json", value: inner }),
      });

      expect(() =>
        mapTraceSummaryToTrace(summary, [], "project-1"),
      ).not.toThrow();
    });
  });
});
