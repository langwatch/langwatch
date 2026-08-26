import { TraceCanonicalisationService } from "@langwatch/trace-server";
import { describe, expect, it } from "vitest";
import { LOG_RECORD_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import {
  applySpanToAnalytics,
  projectAnalyticsStateToRow,
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
} from "../traceAnalytics.foldProjection";
import { createTestSpan } from "./fixtures/trace-summary-test.fixtures";

const TENANT = "tenant-x";

const slimProjection = new TraceAnalyticsFoldProjection({
  traceCanonicalisation: TraceCanonicalisationService.create(),
  store: { store: async () => {}, get: async () => null },
});

function createInitSlimState(): TraceAnalyticsData {
  return slimProjection.init();
}

function projectFromState(state: TraceAnalyticsData) {
  return projectAnalyticsStateToRow({
    state,
    tenantId: TENANT,
    version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  });
}

describe("traceAnalytics fold projection — slim row derivation", () => {
  describe("given a state where cost grows across two spans and origin resolves", () => {
    it("projects the FINAL values onto the slim row", () => {
      // Two LLM spans, increasing cost. Span 2 is the root span with the real
      // langwatch.origin; the per-span fold should resolve origin to that.
      let state = createInitSlimState();
      state = applySpanToAnalytics({
        state,
        span: createTestSpan({
          spanId: "s1",
          parentSpanId: "s-root",
          startTimeUnixMs: 1000,
          endTimeUnixMs: 2000,
          durationMs: 1000,
          spanAttributes: {
            "langwatch.span.type": "llm",
            "gen_ai.response.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 10,
            "gen_ai.usage.output_tokens": 5,
            "langwatch.span.cost": 0.01,
          },
        }),
      });
      state = applySpanToAnalytics({
        state,
        span: createTestSpan({
          spanId: "s-root",
          parentSpanId: null,
          startTimeUnixMs: 500,
          endTimeUnixMs: 3000,
          durationMs: 2500,
          spanAttributes: {
            "langwatch.span.type": "llm",
            "gen_ai.response.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 20,
            "gen_ai.usage.output_tokens": 8,
            "langwatch.span.cost": 0.04,
            "langwatch.origin": "playground",
          },
        }),
      });

      const row = projectFromState(state);

      expect(row.tenantId).toBe(TENANT);
      expect(row.version).toBe(TRACE_ANALYTICS_PROJECTION_VERSION_LATEST);
      expect(row.totalCost).toBeCloseTo(0.05, 6);
      // Both spans contributed prompt/completion tokens.
      expect(row.promptTokens).toBe(30);
      expect(row.completionTokens).toBe(13);
      // Hoisted from langwatch.origin (final value).
      expect(row.origin).toBe("playground");
      expect(row.models).toContain("gpt-5-mini");
    });
  });

  describe("given a state whose attributes carry hoisted user / conversation / customer ids", () => {
    it("surfaces them onto the typed slim columns", () => {
      let state = createInitSlimState();
      state = applySpanToAnalytics({
        state,
        span: createTestSpan({
          parentSpanId: null,
          spanAttributes: {
            "langwatch.user.id": "user-42",
            "gen_ai.conversation.id": "conv-7",
            "langwatch.customer.id": "cust-99",
          },
        }),
      });
      const row = projectFromState(state);
      expect(row.userId).toBe("user-42");
      expect(row.conversationId).toBe("conv-7");
      expect(row.customerId).toBe("cust-99");
    });
  });

  describe("given a state whose labels are stored as a JSON-encoded array string", () => {
    it("parses Labels into a string array on the slim row", () => {
      let state = createInitSlimState();
      state = applySpanToAnalytics({
        state,
        span: createTestSpan({
          parentSpanId: null,
          spanAttributes: {
            "langwatch.labels": JSON.stringify(["alpha", "beta", "gamma"]),
          },
        }),
      });
      const row = projectFromState(state);
      expect(row.labels.sort()).toEqual(["alpha", "beta", "gamma"]);
    });
  });

  describe("given a state whose Attributes include a known-payload key and a long arbitrary value", () => {
    it("emits a slim Attributes map that contains the trimmed subset only", () => {
      const longBlob = "z".repeat(5000); // past metadata cap
      let state = createInitSlimState();
      state = applySpanToAnalytics({
        state,
        span: createTestSpan({
          parentSpanId: null,
          spanAttributes: {
            // Hoisted to trace attrs by SPAN_ATTR_MAPPINGS.
            "gen_ai.agent.name": "weather-agent",
            // Blocklisted payload — must be absent from the slim row.
            "gen_ai.prompt": "what's the weather",
          },
        }),
      });
      // Inject a verbose metadata value to verify truncation.
      state = {
        ...state,
        attributes: {
          ...state.attributes,
          "metadata.big_dump": longBlob,
          // And an over-cap non-metadata/non-reserved key — should be dropped.
          "some.huge.attr": "q".repeat(400),
        },
      };

      const row = projectFromState(state);

      // The known payload key is GONE from slim — this is the validation that
      // slim is genuinely slim, not just "trace_summaries minus I/O".
      expect(row.attributes["gen_ai.prompt"]).toBeUndefined();
      // The verbose metadata is truncated, not dropped.
      const metadataValue = row.attributes["metadata.big_dump"];
      expect(metadataValue).toBeDefined();
      expect(metadataValue!.length).toBeLessThan(longBlob.length);
      // Over-cap arbitrary key is dropped.
      expect(row.attributes["some.huge.attr"]).toBeUndefined();
      // The bounded hoisted attribute survives the trim.
      expect(row.attributes["gen_ai.agent.name"]).toBe("weather-agent");
    });
  });

  describe("given a state without errors and without annotations", () => {
    it("sets HasError false and HasAnnotation null", () => {
      const state = createInitSlimState();
      const row = projectFromState(state);
      expect(row.hasError).toBe(false);
      expect(row.hasAnnotation).toBeNull();
    });
  });

  describe("given a state with at least one annotation id", () => {
    it("sets HasAnnotation true", () => {
      const state: TraceAnalyticsData = {
        ...createInitSlimState(),
        annotationIds: ["ann-1"],
      };
      const row = projectFromState(state);
      expect(row.hasAnnotation).toBe(true);
    });
  });

  describe("given a state with no models / topics", () => {
    it("emits empty arrays and null nullables (slim columns nullable as declared)", () => {
      const state = createInitSlimState();
      const row = projectFromState(state);
      expect(row.models).toEqual([]);
      expect(row.topicId).toBeNull();
      expect(row.subTopicId).toBeNull();
      expect(row.userId).toBeNull();
      expect(row.conversationId).toBeNull();
      expect(row.customerId).toBeNull();
      expect(row.origin).toBe("");
    });
  });

  describe("given a trace whose FIRST signal is a log record", () => {
    const logAtMs = new Date("2026-07-24T12:00:00.000Z").getTime();

    // Through `apply`, not the handler directly: the storage anchor is seeded
    // by the fold's own dispatch so that EVERY contribution type anchors, which
    // a handler-only call would bypass.
    const foldLogRecord = (state: TraceAnalyticsData) =>
      slimProjection.apply(state, {
        type: LOG_RECORD_RECEIVED_EVENT_TYPE,
        occurredAt: logAtMs,
        data: {
          traceId: "trace-log-only",
          spanId: "span-1",
          scopeName: "test",
          body: "hello",
          attributes: {},
          resourceAttributes: {},
        },
      } as never);

    it("anchors the row at the log's own time, not the epoch", () => {
      // The counterpart of the lock this replaces. `OccurredAt` is the
      // partition key AND the TTL anchor, so anchoring a log-only trace at 0
      // committed it into partition 196952 with a deadline of 1970 +
      // retention — expired before it was written. The anchor is now its own
      // state field (ADR-071 step 3), seeded by ANY contribution.
      const state = foldLogRecord(createInitSlimState());

      expect(state.storageAnchorMs).toBe(logAtMs);
      expect(projectFromState(state).occurredAtMs).toBe(logAtMs);

      // And the timing baseline is NOT seeded by the log — that separation is
      // the whole point, and the next test pins what breaks without it.
      expect(state.occurredAt).toBe(0);
    });

    describe("when a span arrives after the log", () => {
      it("reports the span's own duration, not the gap since the log", () => {
        // REGRESSION GUARD. `SpanTimingService` treats `occurredAt > 0` as "a
        // span has seeded the timing baseline" and computes
        // `currentEnd = occurredAt + totalDurationMs`. Seeding `occurredAt` from
        // a log — whose time is the platform ACCEPT time, not producer business
        // time — makes the first span measure from the log instead of from
        // itself, inflating TotalDurationMs by the whole ingest lag and taking
        // TokensPerSecond (completion tokens / duration) with it.
        //
        // The span here completes 1s BEFORE the log is accepted, which is the
        // ordinary case: a producer emits its log after the work finishes.
        const spanStart = logAtMs - 5_000;
        const spanEnd = logAtMs - 1_000;

        const state = applySpanToAnalytics({
          state: foldLogRecord(createInitSlimState()),
          span: createTestSpan({
            spanId: "s-after-log",
            parentSpanId: null,
            startTimeUnixMs: spanStart,
            endTimeUnixMs: spanEnd,
            durationMs: spanEnd - spanStart,
          }),
        });

        expect(state.totalDurationMs).toBe(spanEnd - spanStart);
        expect(state.occurredAt).toBe(spanStart);
      });

      it("reaches the same duration whichever of the two folds first", () => {
        // The inflation was also order-dependent, so one trace could report two
        // different latencies depending on delivery order.
        const spanStart = logAtMs - 5_000;
        const spanEnd = logAtMs - 1_000;
        const span = createTestSpan({
          spanId: "s-order",
          parentSpanId: null,
          startTimeUnixMs: spanStart,
          endTimeUnixMs: spanEnd,
          durationMs: spanEnd - spanStart,
        });

        const logFirst = applySpanToAnalytics({
          state: foldLogRecord(createInitSlimState()),
          span,
        });
        const spanFirst = foldLogRecord(
          applySpanToAnalytics({ state: createInitSlimState(), span }),
        );

        expect(logFirst.totalDurationMs).toBe(spanFirst.totalDurationMs);
        expect(logFirst.occurredAt).toBe(spanFirst.occurredAt);
      });
    });
  });
});
