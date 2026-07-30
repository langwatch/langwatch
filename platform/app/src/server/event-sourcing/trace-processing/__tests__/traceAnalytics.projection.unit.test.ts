import { checkOrderInvariance } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import type {
    AnnotationRef,
    AnnotationsBulkSync,
    CanonicalSpan,
    OriginResolution,
    TopicAssignment,
    TraceNameChange,
} from "../schema";
import {
    deriveTraceAnalyticsView,
    handleAnnotationAdded,
    handleAnnotationRemoved,
    handleAnnotationsBulkSynced,
    handleOriginResolved,
    handleSpanReceived,
    handleTopicAssigned,
    handleTraceNameChanged,
    initTraceAnalyticsState,
    TRACE_ANALYTICS_STATE_VERSION,
    type TraceAnalyticsState,
    traceAnalyticsRowMapping,
} from "../traceAnalytics.projection";
import { canonicalSpan, TRACE_ID } from "./fixtures";

const ROW_CONTEXT = {
  tenantId: "tenant-1",
  key: TRACE_ID,
  version: TRACE_ANALYTICS_STATE_VERSION,
  writtenAt: new Date("2026-07-30T10:00:00.000Z"),
  retentionDays: 308,
};

/** One step this fold's own `.on({...})` map would apply for one event. */
type Step = (state: TraceAnalyticsState) => TraceAnalyticsState;

const spanReceived = (span: CanonicalSpan): Step => (state) =>
  handleSpanReceived(state, span);
const topicAssigned = (data: TopicAssignment): Step => (state) =>
  handleTopicAssigned(state, data);
const originResolved = (data: OriginResolution): Step => (state) =>
  handleOriginResolved(state, data);
const annotationAdded = (data: AnnotationRef): Step => (state) =>
  handleAnnotationAdded(state, data);
const annotationRemoved = (data: AnnotationRef): Step => (state) =>
  handleAnnotationRemoved(state, data);
const annotationsBulkSynced = (data: AnnotationsBulkSync): Step => (state) =>
  handleAnnotationsBulkSynced(state, data);
const traceNameChanged = (data: TraceNameChange): Step => (state) =>
  handleTraceNameChanged(state, data);

function fold(steps: readonly Step[]): TraceAnalyticsState {
  return steps.reduce((state, step) => step(state), initTraceAnalyticsState());
}

const SPAN_WITH_DIMENSIONS = spanReceived(
  canonicalSpan({
    spanId: "s1",
    model: "gpt-5-mini",
    attributes: {
      "langwatch.user_id": "u-1",
      "langwatch.thread_id": "c-1",
      "langwatch.customer_id": "cust-1",
      "langwatch.labels": ["prod"],
      "langwatch.origin": "application",
    },
  }),
);

describe("the traceAnalytics fold", () => {
  describe("given a trace's whole event set", () => {
    /** @scenario "a fold whose fields keep a maximum or a set membership is unaffected by order" */
    it("reaches the same state under every ordering and every re-delivery", () => {
      const report = checkOrderInvariance<TraceAnalyticsState, Step>({
        init: initTraceAnalyticsState,
        apply: (state, step) => step(state),
        events: [
          SPAN_WITH_DIMENSIONS,
          spanReceived(
            canonicalSpan({
              spanId: "s2",
              parentSpanId: "s1",
              name: "child",
              startTimeUnixMs: 1_500,
              endTimeUnixMs: 4_000,
              statusCode: "ERROR",
              model: "gpt-5",
              timeToFirstTokenMs: 300,
              attributes: { "langwatch.labels": ["staging"] },
            }),
          ),
          topicAssigned({
            traceId: TRACE_ID,
            topicId: "t-1",
            topicName: "Topic",
            subtopicId: "sub-1",
            subtopicName: "Sub",
            isIncremental: false,
            assignedAt: 300,
          }),
          topicAssigned({
            traceId: TRACE_ID,
            topicId: "t-2",
            topicName: "Other",
            subtopicId: null,
            subtopicName: null,
            isIncremental: true,
            assignedAt: 300,
          }),
          originResolved({
            traceId: TRACE_ID,
            origin: "simulation",
            reason: "fallback",
          }),
          annotationAdded({ traceId: TRACE_ID, annotationId: "ann-1", actedAt: 400 }),
          annotationsBulkSynced({
            traceId: TRACE_ID,
            annotationIds: ["ann-2", "ann-3"],
            actedAt: 500,
          }),
          annotationRemoved({ traceId: TRACE_ID, annotationId: "ann-2", actedAt: 600 }),
          traceNameChanged({
            traceId: TRACE_ID,
            newName: "Named",
            changedByUserId: "u-1",
            changedAt: 800,
          }),
        ],
      });

      expect(report.counterexample).toBeUndefined();
      expect(report.invariant).toBe(true);
    });
  });

  describe("given spans carrying the dashboard's dimensions", () => {
    it("surfaces user, conversation, customer and origin from the attributes", () => {
      const view = deriveTraceAnalyticsView(fold([SPAN_WITH_DIMENSIONS]));

      expect(view.userId).toBe("u-1");
      expect(view.conversationId).toBe("c-1");
      expect(view.customerId).toBe("cust-1");
      expect(view.origin).toBe("application");
      expect(view.labels).toEqual(["prod"]);
      expect(view.models).toEqual(["gpt-5-mini"]);
    });

    it("reports no origin at all rather than defaulting to application", () => {
      const view = deriveTraceAnalyticsView(
        fold([spanReceived(canonicalSpan({ spanId: "s1" }))]),
      );

      expect(view.origin).toBeNull();
    });
  });

  describe("given a slimmed analytics row this build wrote", () => {
    /** @scenario "a fold whose stored row is a slimmed analytics summary still recovers its working state" */
    it("recovers a working state from the row's own columns", () => {
      const state = fold([
        SPAN_WITH_DIMENSIONS,
        annotationsBulkSynced({
          traceId: TRACE_ID,
          annotationIds: ["ann-1"],
          actedAt: 500,
        }),
        traceNameChanged({
          traceId: TRACE_ID,
          newName: "Named",
          changedByUserId: "u-1",
          changedAt: 800,
        }),
      ]);

      const row = traceAnalyticsRowMapping.toRow(state, ROW_CONTEXT);
      const recovered = traceAnalyticsRowMapping.fromRow(row);
      const view = deriveTraceAnalyticsView(recovered);

      expect(view.traceName).toBe("Named");
      expect(recovered.traceNameChangedAt).toBe(800);
      expect(view.annotationIds).toEqual(["ann-1"]);
      expect(view.labels).toEqual(["prod"]);
      expect(view.userId).toBe("u-1");
      expect(recovered.earliestSpanStartMs).toBe(state.earliestSpanStartMs);
    });
  });
});
