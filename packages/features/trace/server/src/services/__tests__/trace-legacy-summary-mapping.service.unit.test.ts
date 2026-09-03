import { describe, expect, it } from "vitest";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import type { Span } from "@langwatch/trace-contract";
import {
  extractEventsFromSpans,
  mapTraceSummaryToTrace as mapTraceSummaryToTraceWithServices,
} from "../trace-legacy-summary-mapping.service";

const traceCanonicalisation = TraceCanonicalisationService.create();

function mapTraceSummaryToTrace(summary: TraceSummaryData, spans: Span[], projectId: string) {
  return mapTraceSummaryToTraceWithServices(summary, spans, projectId, traceCanonicalisation);
}

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
      const spans = [makeSpan({ params: { "langwatch.span.type": "llm" } })];

      const result = extractEventsFromSpans({
        spans,
        projectId: "project-1",
        traceId: "trace-1",
      });

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

      const result = extractEventsFromSpans({
        spans,
        projectId: "project-1",
        traceId: "trace-1",
      });

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

      const result = extractEventsFromSpans({
        spans,
        projectId: "project-1",
        traceId: "trace-1",
      });

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

      const result = extractEventsFromSpans({
        spans,
        projectId: "project-1",
        traceId: "trace-1",
      });

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
              metrics: {
                valid: "42",
                invalid: "not-a-number",
                inf: "Infinity",
              },
            },
          },
        }),
      ];

      const result = extractEventsFromSpans({
        spans,
        projectId: "project-1",
        traceId: "trace-1",
      });

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

      const result = extractEventsFromSpans({
        spans,
        projectId: "project-1",
        traceId: "trace-1",
      });

      expect(result[0]!.timestamps.updated_at).toBe(6000);
    });
  });
});

function makeSummary(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
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

describe("legacy full-read summary characterization", () => {
  it("preserves the span-time baseline, topic identities, and reserved token metrics", () => {
    const trace = mapTraceSummaryToTrace(
      makeSummary({
        occurredAt: 1_700_000_000_100,
        storageAnchorMs: 1_700_000_000_900,
        topicId: "topic-support",
        subTopicId: "subtopic-billing",
        attributes: {
          "langwatch.reserved.cache_read_tokens": "13",
          "langwatch.reserved.cache_creation_tokens": "17",
          "langwatch.reserved.cache_creation_5m_tokens": "19",
          "langwatch.reserved.cache_creation_1h_tokens": "23",
          "langwatch.reserved.reasoning_tokens": "29",
          "langwatch.reserved.context_size_tokens": "31",
          "langwatch.reserved.log_record_count": "37",
        },
      }),
      [],
      "project-1",
    );

    expect(trace).toMatchObject({
      trace_id: "trace-1",
      project_id: "project-1",
      metadata: {
        topic_id: "topic-support",
        subtopic_id: "subtopic-billing",
        otel_log_record_count: "37",
        "langwatch.reserved.log_record_count": "37",
      },
      timestamps: {
        started_at: 1_700_000_000_100,
      },
      metrics: {
        cache_read_input_tokens: 13,
        cache_creation_input_tokens: 17,
        cache_creation_5m_input_tokens: 19,
        cache_creation_1h_input_tokens: 23,
        reasoning_tokens: 29,
        context_size_tokens: 31,
      },
    });
    expect(trace.timestamps.started_at).not.toBe(1_700_000_000_900);
  });
});

describe("mapTraceSummaryToTrace — the trace's reported start", () => {
  describe("when the trace has spans", () => {
    it("reports the earliest span start, not the time the summary is filed under", () => {
      const summary = makeSummary({
        occurredAt: 1_760_000_055_000,
        storageAnchorMs: 1_760_000_060_000,
      });

      const trace = mapTraceSummaryToTrace(summary, [], "project-1");

      expect(trace.timestamps.started_at).toBe(1_760_000_055_000);
    });
  });

  describe("when the trace's only signal is a log record", () => {
    /** @scenario "A trace with no spans reports the time its first signal arrived rather than 1970" */
    it("reports the time its first signal was accepted", () => {
      // No span ever seeded the timing baseline, so before the storage anchor
      // existed this rendered as 1970 in the list and the drawer.
      const summary = makeSummary({
        spanCount: 0,
        occurredAt: 0,
        storageAnchorMs: 1_760_000_060_000,
      });

      const trace = mapTraceSummaryToTrace(summary, [], "project-1");

      expect(trace.timestamps.started_at).toBe(1_760_000_060_000);
    });
  });
});

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

      expect(() => mapTraceSummaryToTrace(summary, [], "project-1")).not.toThrow();
    });
  });
});

describe("mapTraceSummaryToTrace — metadata.models", () => {
  describe("when the attribute holds the fold's JSON array", () => {
    it("surfaces it as a real array", () => {
      const summary = makeSummary({
        attributes: {
          "metadata.models": JSON.stringify(["claude-opus-5", "gpt-5"]),
        },
      });

      const trace = mapTraceSummaryToTrace(summary, [], "project-1");

      expect(trace.metadata.models).toEqual(["claude-opus-5", "gpt-5"]);
    });
  });

  describe("when a user set the attribute to a value that is not a JSON array", () => {
    it("keeps a scalar reachable through the generic passthrough", () => {
      const summary = makeSummary({
        attributes: { "metadata.models": "claude-opus-5" },
      });

      const trace = mapTraceSummaryToTrace(summary, [], "project-1");

      expect(trace.metadata.models).toBe("claude-opus-5");
    });

    it("keeps a JSON object reachable through the generic passthrough", () => {
      const raw = JSON.stringify({ primary: "claude-opus-5" });
      const summary = makeSummary({ attributes: { "metadata.models": raw } });

      const trace = mapTraceSummaryToTrace(summary, [], "project-1");

      expect(trace.metadata.models).toBe(raw);
    });
  });
});

describe("mapTraceSummaryToTrace — reserved token metrics", () => {
  describe("when the fold stamped cache and reasoning token attributes", () => {
    /** @scenario metrics carries the token fields the projection catalog already advertises */
    it("surfaces them as the typed metric fields the projection catalog advertises", () => {
      const summary = makeSummary({
        attributes: {
          "langwatch.reserved.cache_read_tokens": "120000",
          "langwatch.reserved.cache_creation_tokens": "3456",
          "langwatch.reserved.reasoning_tokens": "789",
        },
      });

      const trace = mapTraceSummaryToTrace(summary, [], "project-1");

      expect(trace.metrics?.cache_read_input_tokens).toBe(120000);
      expect(trace.metrics?.cache_creation_input_tokens).toBe(3456);
      expect(trace.metrics?.reasoning_tokens).toBe(789);
    });
  });

  describe("when the fold stamped context size and the cache TTL split", () => {
    /** @scenario metrics carries context size and the cache creation TTL split */
    it("surfaces context_size_tokens and the 5m and 1h cache creation counts", () => {
      const summary = makeSummary({
        attributes: {
          "langwatch.reserved.context_size_tokens": "523544",
          "langwatch.reserved.cache_creation_5m_tokens": "111",
          "langwatch.reserved.cache_creation_1h_tokens": "18205",
        },
      });

      const trace = mapTraceSummaryToTrace(summary, [], "project-1");

      expect(trace.metrics?.context_size_tokens).toBe(523544);
      expect(trace.metrics?.cache_creation_5m_input_tokens).toBe(111);
      expect(trace.metrics?.cache_creation_1h_input_tokens).toBe(18205);
    });
  });

  describe("when no reserved token attributes are present", () => {
    /** @scenario absent reserved token attributes leave the metrics fields unset */
    it("keeps the metrics block at exactly the six legacy fields", () => {
      const summary = makeSummary({ attributes: {} });

      const trace = mapTraceSummaryToTrace(summary, [], "project-1");

      expect(Object.keys(trace.metrics ?? {}).sort()).toEqual([
        "completion_tokens",
        "first_token_ms",
        "prompt_tokens",
        "tokens_estimated",
        "total_cost",
        "total_time_ms",
      ]);
    });
  });

  describe("when a reserved token attribute is not numeric", () => {
    it("adds no metric key for it", () => {
      const summary = makeSummary({
        attributes: {
          "langwatch.reserved.context_size_tokens": "not-a-number",
        },
      });

      const trace = mapTraceSummaryToTrace(summary, [], "project-1");

      expect(trace.metrics).not.toHaveProperty("context_size_tokens");
    });
  });
});

describe("mapAttributesToMetadata — otel_log_record_count sibling", () => {
  describe("when the fold stamped a log record count", () => {
    /** @scenario existing metadata keys flow untouched and otel_log_record_count is added as a sibling */
    it("keeps the raw reserved key untouched and adds the clearly named sibling", () => {
      const summary = makeSummary({
        attributes: { "langwatch.reserved.log_record_count": "56353" },
      });

      const trace = mapTraceSummaryToTrace(summary, [], "project-1");

      expect(trace.metadata["langwatch.reserved.log_record_count"]).toBe("56353");
      expect(trace.metadata.otel_log_record_count).toBe("56353");
    });
  });

  describe("when the caller defined its own otel_log_record_count metadata", () => {
    /** @scenario a caller-defined otel_log_record_count metadata key is never overwritten */
    it("keeps the caller's value", () => {
      const summary = makeSummary({
        attributes: {
          "metadata.otel_log_record_count": "caller-value",
          "langwatch.reserved.log_record_count": "56353",
        },
      });

      const trace = mapTraceSummaryToTrace(summary, [], "project-1");

      expect(trace.metadata.otel_log_record_count).toBe("caller-value");
    });
  });
});
