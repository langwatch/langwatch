import { checkOrderInvariance } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import type {
    AnnotationRef,
    AnnotationsBulkSync,
    CanonicalSpan,
    LogContribution,
    MetricCorrelation,
    OriginResolution,
    TopicAssignment,
    TraceNameChange,
} from "../schema";
import {
    deriveTraceSummaryView,
    handleAnnotationAdded,
    handleAnnotationRemoved,
    handleAnnotationsBulkSynced,
    handleLogContributed,
    handleMetricDataPointCorrelated,
    handleOriginResolved,
    handleSpanReceived,
    handleTopicAssigned,
    handleTraceNameChanged,
    initTraceSummaryState,
    TRACE_SUMMARY_STATE_VERSION,
    type TraceSummaryState,
    traceSummaryRowMapping,
} from "../traceSummary.projection";
import { canonicalSpan, TRACE_ID } from "./fixtures";

const ROW_CONTEXT = {
  tenantId: "tenant-1",
  key: TRACE_ID,
  version: TRACE_SUMMARY_STATE_VERSION,
  writtenAt: new Date("2026-07-30T10:00:00.000Z"),
  retentionDays: 308,
};

/** One step this fold's own `.on({...})` map would apply for one event. */
type Step = (state: TraceSummaryState) => TraceSummaryState;

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
const traceNameChanged = (data: TraceNameChange): Step => (state) =>
  handleTraceNameChanged(state, data);
const logContributed = (data: LogContribution): Step => (state) =>
  handleLogContributed(state, data);
const metricDataPointCorrelated = (data: MetricCorrelation): Step => (state) =>
  handleMetricDataPointCorrelated(state, data);
const annotationsBulkSynced = (data: AnnotationsBulkSync): Step => (state) =>
  handleAnnotationsBulkSynced(state, data);

function fold(steps: readonly Step[]): TraceSummaryState {
  return steps.reduce((state, step) => step(state), initTraceSummaryState());
}

describe("the traceSummary fold", () => {
  describe("given a trace's whole event set", () => {
    /** @scenario "re-delivering an event a fold has already seen changes nothing" */
    it("reaches the same state under every ordering and every re-delivery", () => {
      const report = checkOrderInvariance<TraceSummaryState, Step>({
        init: initTraceSummaryState,
        apply: (state, step) => step(state),
        events: [
          spanReceived(
            canonicalSpan({
              spanId: "s1",
              startTimeUnixMs: 1_000,
              endTimeUnixMs: 3_000,
              model: "gpt-5-mini",
              cost: { cost: 0.5, nonBilledCost: 0.1 },
              usage: {
                inputTokens: 10,
                outputTokens: 20,
                reasoningTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                estimated: false,
              },
              io: {
                inputText: "hello",
                inputIsExplicit: true,
                outputText: "world",
                outputIsExplicit: true,
              },
              attributes: {
                "langwatch.labels": ["a"],
                "langwatch.user_id": "u-1",
              },
              timeToFirstTokenMs: 120,
              timeToLastTokenMs: 900,
              piiRedactionStatus: "partial",
            }),
          ),
          spanReceived(
            canonicalSpan({
              spanId: "s2",
              parentSpanId: "s1",
              name: "child",
              startTimeUnixMs: 1_500,
              endTimeUnixMs: 2_500,
              statusCode: "ERROR",
              statusMessage: "boom",
              model: "gpt-5",
              cost: { cost: 0.25, nonBilledCost: null },
              attributes: { "langwatch.labels": ["b"] },
              prompt: { promptId: "p-1", versionId: "v-1", versionNumber: 1 },
            }),
          ),
          topicAssigned({
            traceId: TRACE_ID,
            topicId: "t-1",
            topicName: "Topic",
            subtopicId: null,
            subtopicName: null,
            isIncremental: false,
            assignedAt: 200,
          }),
          topicAssigned({
            traceId: TRACE_ID,
            topicId: "t-2",
            topicName: "Other",
            subtopicId: "s-2",
            subtopicName: "Sub",
            isIncremental: false,
            assignedAt: 100,
          }),
          originResolved({
            traceId: TRACE_ID,
            origin: "evaluation",
            reason: "fallback",
          }),
          annotationAdded({
            traceId: TRACE_ID,
            annotationId: "ann-1",
            actedAt: 500,
          }),
          annotationRemoved({
            traceId: TRACE_ID,
            annotationId: "ann-1",
            actedAt: 500,
          }),
          annotationsBulkSynced({
            traceId: TRACE_ID,
            annotationIds: ["ann-2"],
            actedAt: 600,
          }),
          traceNameChanged({
            traceId: TRACE_ID,
            newName: "Renamed",
            changedByUserId: "u-1",
            changedAt: 700,
          }),
          traceNameChanged({
            traceId: TRACE_ID,
            newName: "Older",
            changedByUserId: "u-2",
            changedAt: 650,
          }),
          logContributed({
            traceId: TRACE_ID,
            spanId: "s3",
            recordId: "r-1",
            timeUnixMs: 4_000,
            severityNumber: 9,
            severityText: "INFO",
            body: "log line",
            attributes: {},
            resourceAttributes: {},
            scopeName: "scope",
            scopeVersion: null,
            piiRedactionLevel: "ESSENTIAL",
          }),
          metricDataPointCorrelated({
            traceId: TRACE_ID,
            spanId: "f".repeat(16),
            pointId: "c".repeat(64),
            seriesId: "d".repeat(64),
            metricName: "gen_ai.server.time_to_first_token",
            metricUnit: "ms",
            metricKind: "histogram",
            exemplarValue: 90,
            exemplarTimeUnixMs: 1_100,
          }),
        ],
      });

      expect(report.counterexample).toBeUndefined();
      expect(report.invariant).toBe(true);
    });
  });

  describe("given two spans that both carry input text", () => {
    /** @scenario "Accumulator uses extracted text not raw JSON wrapper" */
    it("keeps the explicitly-extracted text over a fallback extraction", () => {
      const state = fold([
        spanReceived(
          canonicalSpan({
            spanId: "s2",
            parentSpanId: "s1",
            io: {
              inputText: '{"messages":[{"content":"hi"}]}',
              inputIsExplicit: false,
              outputText: null,
              outputIsExplicit: false,
            },
          }),
        ),
        spanReceived(
          canonicalSpan({
            spanId: "s3",
            parentSpanId: "s1",
            io: {
              inputText: "hi",
              inputIsExplicit: true,
              outputText: null,
              outputIsExplicit: false,
            },
          }),
        ),
      ]);

      expect(deriveTraceSummaryView(state).computedInput).toBe("hi");
    });

    /** @scenario "Accumulator falls back to raw stringification when no text extracted" */
    it("keeps the fallback text when no span extracted anything explicitly", () => {
      const state = fold([
        spanReceived(
          canonicalSpan({
            spanId: "s2",
            parentSpanId: "s1",
            io: {
              inputText: '{"raw":true}',
              inputIsExplicit: false,
              outputText: null,
              outputIsExplicit: false,
            },
          }),
        ),
      ]);

      expect(deriveTraceSummaryView(state).computedInput).toBe('{"raw":true}');
    });
  });

  describe("when an annotation is added and removed in the same instant", () => {
    it("settles on absent whichever order the two arrive in", () => {
      const removedLast = fold([
        annotationAdded({ traceId: TRACE_ID, annotationId: "ann-1", actedAt: 42 }),
        annotationRemoved({ traceId: TRACE_ID, annotationId: "ann-1", actedAt: 42 }),
      ]);
      const addedLast = fold([
        annotationRemoved({ traceId: TRACE_ID, annotationId: "ann-1", actedAt: 42 }),
        annotationAdded({ traceId: TRACE_ID, annotationId: "ann-1", actedAt: 42 }),
      ]);

      expect(deriveTraceSummaryView(removedLast).annotationIds).toEqual([]);
      expect(deriveTraceSummaryView(addedLast).annotationIds).toEqual([]);
    });
  });

  describe("when a rename arrives after a newer one", () => {
    it("keeps the newer name, because the stamp orders them", () => {
      const state = fold([
        traceNameChanged({
          traceId: TRACE_ID,
          newName: "Newer",
          changedByUserId: null,
          changedAt: 900,
        }),
        traceNameChanged({
          traceId: TRACE_ID,
          newName: "Older",
          changedByUserId: null,
          changedAt: 100,
        }),
      ]);

      expect(deriveTraceSummaryView(state).traceName).toBe("Newer");
    });
  });

  describe("given a trace whose spans push it past the derivation threshold", () => {
    it("still derives every span, because storage and derivation both stay lossless", () => {
      const steps: Step[] = [];
      for (let index = 0; index < 600; index++) {
        steps.push(
          spanReceived(
            canonicalSpan({
              spanId: `span-${String(index).padStart(4, "0")}`,
              parentSpanId: index === 0 ? null : "span-0000",
              name: `span-${index}`,
              startTimeUnixMs: 1_000 + index,
              endTimeUnixMs: 1_100 + index,
              attributes: { [`attr.${index}`]: index },
            }),
          ),
        );
      }
      const state = fold(steps);

      expect(state.attributes.size).toBe(600);
      expect(deriveTraceSummaryView(state).traceName).toBe("span-0");
    });
  });

  describe("given a summary this build wrote", () => {
    /** @scenario "A trace summary written by the current build is read straight back" */
    it("reads its own row back into a state that keeps folding", () => {
      const state = fold([
        spanReceived(
          canonicalSpan({
            spanId: "s1",
            name: "root",
            model: "gpt-5-mini",
            io: {
              inputText: "in",
              inputIsExplicit: true,
              outputText: "out",
              outputIsExplicit: true,
            },
            attributes: { "langwatch.user_id": "u-1" },
          }),
        ),
        traceNameChanged({
          traceId: TRACE_ID,
          newName: "Named",
          changedByUserId: "u-1",
          changedAt: 700,
        }),
        topicAssigned({
          traceId: TRACE_ID,
          topicId: "t-1",
          topicName: "Topic",
          subtopicId: null,
          subtopicName: null,
          isIncremental: false,
          assignedAt: 200,
        }),
      ]);

      const row = traceSummaryRowMapping.toRow(state, ROW_CONTEXT);
      const recovered = traceSummaryRowMapping.fromRow(row);

      expect(recovered.traceNameOverride).toBe("Named");
      expect(recovered.traceNameChangedAt).toBe(700);
      expect(recovered.topicId).toBe("t-1");
      expect(recovered.topicAssignedAt).toBe(200);
      expect(deriveTraceSummaryView(recovered).computedInput).toBe("in");
      expect(deriveTraceSummaryView(recovered).models).toEqual(["gpt-5-mini"]);
    });

    /** @scenario "a user-visible name survives a late unrelated contribution" */
    it("keeps the user's name after a later span lands on the recovered state", () => {
      const state = fold([
        spanReceived(canonicalSpan({ spanId: "s1" })),
        traceNameChanged({
          traceId: TRACE_ID,
          newName: "Named",
          changedByUserId: "u-1",
          changedAt: 700,
        }),
      ]);

      const recovered = traceSummaryRowMapping.fromRow(
        traceSummaryRowMapping.toRow(state, ROW_CONTEXT),
      );
      const afterLateSpan = handleSpanReceived(
        recovered,
        canonicalSpan({ spanId: "s9", name: "late", startTimeUnixMs: 5_000 }),
      );

      expect(deriveTraceSummaryView(afterLateSpan).traceName).toBe("Named");
    });

    it("stamps the row's partition anchor from the earliest span start", () => {
      const state = fold([
        spanReceived(canonicalSpan({ spanId: "s1", startTimeUnixMs: 4_000 })),
        spanReceived(canonicalSpan({ spanId: "s0", startTimeUnixMs: 1_000 })),
      ]);

      const row = traceSummaryRowMapping.toRow(state, ROW_CONTEXT);

      expect(row.AcceptedAt.getTime()).toBe(1_000);
      expect(row.OccurredAt.getTime()).toBe(1_000);
    });
  });
});
