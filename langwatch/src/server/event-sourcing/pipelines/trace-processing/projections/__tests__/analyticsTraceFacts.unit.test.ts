import { describe, expect, it } from "vitest";
import type { AnalyticsTraceFactData } from "~/server/app-layer/analytics/types";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import type {
  MetricRecordReceivedEvent,
  SpanReceivedEvent,
  TopicAssignedEvent,
  LogRecordReceivedEvent,
  OriginResolvedEvent,
} from "../../schemas/events";
import { NormalizedSpanKind } from "../../schemas/spans";
import {
  AnalyticsTraceFactsFoldProjection,
  applySpanToAnalyticsFacts,
} from "../analyticsTraceFacts.foldProjection";
import { createTestSpan } from "./fixtures/trace-summary-test.fixtures";

function createStubStore(): FoldProjectionStore<AnalyticsTraceFactData> {
  return {
    store: async () => {},
    get: async () => null,
  };
}

function createProjection() {
  return new AnalyticsTraceFactsFoldProjection({
    store: createStubStore(),
  });
}

function createInitState(): AnalyticsTraceFactData {
  return createProjection().init();
}

function createSpanReceivedEvent(
  overrides: Partial<SpanReceivedEvent> = {},
): SpanReceivedEvent {
  return {
    id: "evt-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: "2025-12-14",
    data: {
      span: {
        traceId: "trace-1",
        spanId: "span-1",
        parentSpanId: null,
        traceState: null,
        name: "test-span",
        kind: 1,
        startTimeUnixNano: "1000000000000",
        endTimeUnixNano: "2000000000000",
        attributes: [],
        events: [],
        links: [],
        status: { message: null, code: null },
        flags: null,
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "disabled",
    },
    metadata: {
      spanId: "span-1",
      traceId: "trace-1",
    },
    ...overrides,
  } as unknown as SpanReceivedEvent;
}

function createTopicAssignedEvent(
  overrides: Partial<TopicAssignedEvent> = {},
): TopicAssignedEvent {
  return {
    id: "evt-2",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.topic_assigned",
    version: "2025-02-01",
    data: {
      topicId: "topic-1",
      topicName: "Topic One",
      subtopicId: "subtopic-1",
      subtopicName: "Subtopic One",
      isIncremental: false,
    },
    metadata: {},
    ...overrides,
  } as unknown as TopicAssignedEvent;
}

function createMetricRecordReceivedEvent(
  overrides: Partial<MetricRecordReceivedEvent> = {},
): MetricRecordReceivedEvent {
  return {
    id: "evt-3",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.metric_record_received",
    version: "2026-03-08",
    data: {
      traceId: "trace-1",
      spanId: "span-1",
      metricName: "gen_ai.server.time_to_first_token",
      metricUnit: "s",
      metricType: "gauge",
      value: 0.5,
      timeUnixMs: 1000,
      attributes: {},
      resourceAttributes: {},
    },
    metadata: {},
    ...overrides,
  } as unknown as MetricRecordReceivedEvent;
}

function createLogRecordReceivedEvent(
  overrides: Partial<LogRecordReceivedEvent> = {},
): LogRecordReceivedEvent {
  return {
    id: "evt-4",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.log_record_received",
    version: "2026-03-08",
    data: {
      traceId: "trace-1",
      spanId: "span-1",
      timeUnixMs: 1000,
      severityNumber: 9,
      severityText: "INFO",
      body: "test log",
      attributes: {},
      resourceAttributes: {},
      scopeName: "test",
      scopeVersion: null,
      piiRedactionLevel: "disabled",
    },
    metadata: {},
    ...overrides,
  } as unknown as LogRecordReceivedEvent;
}

function createOriginResolvedEvent(
  overrides: Partial<OriginResolvedEvent> = {},
): OriginResolvedEvent {
  return {
    id: "evt-5",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.origin_resolved",
    version: "2026-03-13",
    data: {
      origin: "api",
      reason: "inferred",
    },
    metadata: {},
    ...overrides,
  } as unknown as OriginResolvedEvent;
}

describe("analyticsTraceFacts foldProjection", () => {
  describe("init()", () => {
    it("returns initial state with timestamps and zero defaults", () => {
      const state = createInitState();

      expect(state.traceId).toBe("");
      expect(state.spanCount).toBe(0);
      expect(state.occurredAt).toBe(0);
      expect(state.userId).toBe("");
      expect(state.threadId).toBe("");
      expect(state.customerId).toBe("");
      expect(state.labels).toEqual([]);
      expect(state.topicId).toBeNull();
      expect(state.subTopicId).toBeNull();
      expect(state.metadata).toEqual({});
      expect(state.totalCost).toBeNull();
      expect(state.totalDurationMs).toBe(0);
      expect(state.totalPromptTokens).toBeNull();
      expect(state.totalCompletionTokens).toBeNull();
      expect(state.tokensPerSecond).toBeNull();
      expect(state.timeToFirstTokenMs).toBeNull();
      expect(state.containsError).toBe(false);
      expect(state.hasAnnotation).toBeNull();
      expect(state.modelNames).toEqual([]);
      expect(state.modelPromptTokens).toEqual([]);
      expect(state.modelCompletionTokens).toEqual([]);
      expect(state.modelCosts).toEqual([]);
      expect(state.eventTypes).toEqual([]);
      expect(state.thumbsUpDownVote).toBeNull();
      expect(state.ragDocumentIds).toEqual([]);
      expect(state.ragDocumentContents).toEqual([]);
      expect(state.createdAt).toBeGreaterThan(0);
      expect(state.updatedAt).toBeGreaterThan(0);
    });
  });

  describe("applySpanToAnalyticsFacts()", () => {
    describe("when processing a span with userId, threadId, and customerId", () => {
      it("extracts known metadata fields into top-level columns", () => {
        const state = createInitState();
        const span = createTestSpan({
          traceId: "trace-1",
          spanAttributes: {
            "langwatch.user.id": "user-42",
            "gen_ai.conversation.id": "thread-abc",
            "langwatch.customer.id": "cust-99",
          },
        });

        const result = applySpanToAnalyticsFacts({ state, span });

        expect(result.userId).toBe("user-42");
        expect(result.threadId).toBe("thread-abc");
        expect(result.customerId).toBe("cust-99");
        expect(result.spanCount).toBe(1);
        expect(result.traceId).toBe("trace-1");
      });
    });

    describe("when processing a span with labels", () => {
      it("extracts labels from JSON string array", () => {
        const state = createInitState();
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.labels": '["important","urgent"]',
          },
        });

        const result = applySpanToAnalyticsFacts({ state, span });

        expect(result.labels).toEqual(["important", "urgent"]);
      });

      it("unions labels across multiple spans", () => {
        let state = createInitState();
        const span1 = createTestSpan({
          spanAttributes: {
            "langwatch.labels": '["important"]',
          },
        });
        const span2 = createTestSpan({
          spanAttributes: {
            "langwatch.labels": '["important","urgent"]',
          },
        });

        state = applySpanToAnalyticsFacts({ state, span: span1 });
        state = applySpanToAnalyticsFacts({ state, span: span2 });

        expect(state.labels).toEqual(["important", "urgent"]);
      });
    });

    describe("when processing spans with model and tokens", () => {
      it("accumulates per-model token counts", () => {
        let state = createInitState();

        const llmSpan = createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.output_tokens": 50,
          },
        });

        state = applySpanToAnalyticsFacts({ state, span: llmSpan });

        expect(state.modelNames).toEqual(["gpt-5-mini"]);
        expect(state.modelPromptTokens).toEqual([100]);
        expect(state.modelCompletionTokens).toEqual([50]);
        expect(state.totalPromptTokens).toBe(100);
        expect(state.totalCompletionTokens).toBe(50);
      });

      it("accumulates tokens for the same model across multiple spans", () => {
        let state = createInitState();

        const span1 = createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.output_tokens": 50,
          },
        });
        const span2 = createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 200,
            "gen_ai.usage.output_tokens": 100,
          },
        });

        state = applySpanToAnalyticsFacts({ state, span: span1 });
        state = applySpanToAnalyticsFacts({ state, span: span2 });

        expect(state.modelNames).toEqual(["gpt-5-mini"]);
        expect(state.modelPromptTokens).toEqual([300]);
        expect(state.modelCompletionTokens).toEqual([150]);
        expect(state.totalPromptTokens).toBe(300);
        expect(state.totalCompletionTokens).toBe(150);
      });

      it("tracks separate models in parallel arrays", () => {
        let state = createInitState();

        const span1 = createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.output_tokens": 50,
          },
        });
        const span2 = createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "claude-opus-4-6",
            "gen_ai.usage.input_tokens": 200,
            "gen_ai.usage.output_tokens": 80,
          },
        });

        state = applySpanToAnalyticsFacts({ state, span: span1 });
        state = applySpanToAnalyticsFacts({ state, span: span2 });

        expect(state.modelNames).toEqual(["gpt-5-mini", "claude-opus-4-6"]);
        expect(state.modelPromptTokens).toEqual([100, 200]);
        expect(state.modelCompletionTokens).toEqual([50, 80]);
        expect(state.totalPromptTokens).toBe(300);
        expect(state.totalCompletionTokens).toBe(130);
      });
    });

    describe("when processing spans with events", () => {
      it("extracts event types and score metrics", () => {
        const state = createInitState();
        const span = createTestSpan({
          events: [
            {
              name: "thumbs_up_down",
              timeUnixMs: 1500,
              attributes: { vote: 1 },
            },
            {
              name: "feedback",
              timeUnixMs: 1600,
              attributes: {
                feedback: "Great response!",
                score: 0.95,
              },
            },
          ],
        });

        const result = applySpanToAnalyticsFacts({ state, span });

        expect(result.eventTypes).toEqual(["thumbs_up_down", "feedback"]);
        expect(result.thumbsUpDownVote).toBe(1);
        expect(result.eventScoreKeys).toContain("vote");
        expect(result.eventScoreKeys).toContain("score");
        expect(result.eventDetailKeys).toContain("feedback");
        expect(result.eventDetailValues).toContain("Great response!");
      });
    });

    describe("when processing a span with RAG contexts", () => {
      it("extracts document IDs and contents", () => {
        const state = createInitState();
        const span = createTestSpan({
          spanAttributes: {
            "langwatch.rag.contexts": [
              { document_id: "doc-1", content: "First document content" },
              { document_id: "doc-2", content: "Second document content" },
            ],
          },
        });

        const result = applySpanToAnalyticsFacts({ state, span });

        expect(result.ragDocumentIds).toEqual(["doc-1", "doc-2"]);
        expect(result.ragDocumentContents).toEqual([
          "First document content",
          "Second document content",
        ]);
      });
    });

    describe("when processing a span with an error status", () => {
      it("sets containsError to true", () => {
        const state = createInitState();
        const span = createTestSpan({
          statusCode: 2, // ERROR
          statusMessage: "Something went wrong",
        });

        const result = applySpanToAnalyticsFacts({ state, span });

        expect(result.containsError).toBe(true);
      });
    });

    describe("when processing spans with metadata attributes", () => {
      it("extracts metadata.* attributes to the metadata map", () => {
        const state = createInitState();
        const span = createTestSpan({
          spanAttributes: {
            "metadata.environment": "production",
            "metadata.version": "1.2.3",
          },
        });

        const result = applySpanToAnalyticsFacts({ state, span });

        expect(result.metadata["metadata.environment"]).toBe("production");
        expect(result.metadata["metadata.version"]).toBe("1.2.3");
      });

      it("omits metadata values longer than 256 characters", () => {
        const state = createInitState();
        const longValue = "x".repeat(257);
        const span = createTestSpan({
          spanAttributes: {
            "metadata.short": "ok",
            "metadata.long": longValue,
          },
        });

        const result = applySpanToAnalyticsFacts({ state, span });

        expect(result.metadata["metadata.short"]).toBe("ok");
        expect(result.metadata["metadata.long"]).toBeUndefined();
      });
    });

    describe("when processing timing across spans", () => {
      it("computes occurredAt as the earliest span start time", () => {
        let state = createInitState();

        const span1 = createTestSpan({
          startTimeUnixMs: 5000,
          endTimeUnixMs: 6000,
        });
        const span2 = createTestSpan({
          startTimeUnixMs: 3000,
          endTimeUnixMs: 8000,
        });

        state = applySpanToAnalyticsFacts({ state, span: span1 });
        state = applySpanToAnalyticsFacts({ state, span: span2 });

        expect(state.occurredAt).toBe(3000);
        expect(state.totalDurationMs).toBe(5000); // 8000 - 3000
      });
    });
  });

  describe("apply()", () => {
    describe("when TopicAssignedEvent arrives", () => {
      it("sets topicId and subTopicId", () => {
        const projection = createProjection();
        const state = createInitState();

        const result = projection.apply(state, createTopicAssignedEvent());

        expect(result.topicId).toBe("topic-1");
        expect(result.subTopicId).toBe("subtopic-1");
      });
    });

    describe("when MetricRecordReceivedEvent arrives with time_to_first_token", () => {
      it("sets timeToFirstTokenMs from the metric value in seconds", () => {
        const projection = createProjection();
        const state = createInitState();

        const result = projection.apply(
          state,
          createMetricRecordReceivedEvent(),
        );

        expect(result.timeToFirstTokenMs).toBe(500);
      });

      it("takes the minimum when multiple TTFT metrics arrive", () => {
        const projection = createProjection();
        let state = createInitState();

        state = projection.apply(
          state,
          createMetricRecordReceivedEvent({
            data: {
              traceId: "trace-1",
              spanId: "span-1",
              metricName: "gen_ai.server.time_to_first_token",
              metricUnit: "s",
              metricType: "gauge",
              value: 0.8,
              timeUnixMs: 1000,
              attributes: {},
              resourceAttributes: {},
            },
          } as Partial<MetricRecordReceivedEvent>),
        );
        state = projection.apply(
          state,
          createMetricRecordReceivedEvent({
            data: {
              traceId: "trace-1",
              spanId: "span-2",
              metricName: "gen_ai.server.time_to_first_token",
              metricUnit: "s",
              metricType: "gauge",
              value: 0.3,
              timeUnixMs: 2000,
              attributes: {},
              resourceAttributes: {},
            },
          } as Partial<MetricRecordReceivedEvent>),
        );

        expect(state.timeToFirstTokenMs).toBe(300);
      });
    });

    describe("when LogRecordReceivedEvent arrives", () => {
      it("returns state unchanged (no-op for analytics)", () => {
        const projection = createProjection();
        const state = createInitState();

        const result = projection.apply(
          state,
          createLogRecordReceivedEvent(),
        );

        // State should be identical except for updatedAt
        expect(result.spanCount).toBe(state.spanCount);
        expect(result.traceId).toBe(state.traceId);
      });
    });

    describe("when OriginResolvedEvent arrives", () => {
      it("returns state unchanged (origin not in analytics schema)", () => {
        const projection = createProjection();
        const state = createInitState();

        const result = projection.apply(
          state,
          createOriginResolvedEvent(),
        );

        expect(result.spanCount).toBe(state.spanCount);
        expect(result.traceId).toBe(state.traceId);
      });
    });

    describe("when a non-metric MetricRecordReceivedEvent arrives", () => {
      it("returns state unchanged for unrecognized metric names", () => {
        const projection = createProjection();
        const state = createInitState();

        const result = projection.apply(
          state,
          createMetricRecordReceivedEvent({
            data: {
              traceId: "trace-1",
              spanId: "span-1",
              metricName: "custom.metric",
              metricUnit: "count",
              metricType: "gauge",
              value: 42,
              timeUnixMs: 1000,
              attributes: {},
              resourceAttributes: {},
            },
          } as Partial<MetricRecordReceivedEvent>),
        );

        expect(result.timeToFirstTokenMs).toBeNull();
      });
    });
  });

  describe("projection metadata", () => {
    it("has correct name, version, and timestampStyle", () => {
      const projection = createProjection();

      expect(projection.name).toBe("analyticsTraceFacts");
      expect(projection.version).toBe("2026-04-01");
      expect(projection.eventTypes).toHaveLength(5);
    });
  });

  describe("full flow", () => {
    describe("when processing multiple spans with models, events, and RAG", () => {
      it("accumulates all analytics fields correctly", () => {
        let state = createInitState();

        const rootSpan = createTestSpan({
          id: "root-1",
          traceId: "trace-1",
          spanId: "root-1",
          parentSpanId: null,
          startTimeUnixMs: 1000,
          endTimeUnixMs: 5000,
          durationMs: 4000,
          name: "root",
          kind: NormalizedSpanKind.SERVER,
          spanAttributes: {
            "langwatch.user.id": "user-1",
            "gen_ai.conversation.id": "thread-1",
            "langwatch.customer.id": "cust-1",
            "langwatch.labels": '["production"]',
            "metadata.env": "prod",
          },
        });

        const llmSpan = createTestSpan({
          id: "llm-1",
          traceId: "trace-1",
          spanId: "llm-1",
          parentSpanId: "root-1",
          startTimeUnixMs: 1100,
          endTimeUnixMs: 4000,
          durationMs: 2900,
          name: "llm",
          kind: NormalizedSpanKind.INTERNAL,
          spanAttributes: {
            "langwatch.span.type": "llm",
            "gen_ai.request.model": "gpt-5-mini",
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.output_tokens": 50,
          },
          events: [
            {
              name: "thumbs_up_down",
              timeUnixMs: 2000,
              attributes: { vote: 1 },
            },
          ],
        });

        const ragSpan = createTestSpan({
          id: "rag-1",
          traceId: "trace-1",
          spanId: "rag-1",
          parentSpanId: "root-1",
          startTimeUnixMs: 4100,
          endTimeUnixMs: 4500,
          durationMs: 400,
          name: "retrieval",
          kind: NormalizedSpanKind.INTERNAL,
          spanAttributes: {
            "langwatch.rag.contexts": [
              { document_id: "doc-1", content: "RAG content" },
            ],
          },
        });

        state = applySpanToAnalyticsFacts({ state, span: rootSpan });
        state = applySpanToAnalyticsFacts({ state, span: llmSpan });
        state = applySpanToAnalyticsFacts({ state, span: ragSpan });

        expect(state.traceId).toBe("trace-1");
        expect(state.spanCount).toBe(3);
        expect(state.userId).toBe("user-1");
        expect(state.threadId).toBe("thread-1");
        expect(state.customerId).toBe("cust-1");
        expect(state.labels).toEqual(["production"]);
        expect(state.metadata["metadata.env"]).toBe("prod");
        expect(state.modelNames).toEqual(["gpt-5-mini"]);
        expect(state.modelPromptTokens).toEqual([100]);
        expect(state.modelCompletionTokens).toEqual([50]);
        expect(state.totalPromptTokens).toBe(100);
        expect(state.totalCompletionTokens).toBe(50);
        expect(state.thumbsUpDownVote).toBe(1);
        expect(state.ragDocumentIds).toEqual(["doc-1"]);
        expect(state.ragDocumentContents).toEqual(["RAG content"]);
        expect(state.occurredAt).toBe(1000);
        expect(state.totalDurationMs).toBe(4000); // 5000 - 1000 (root span end)
      });
    });
  });
});
