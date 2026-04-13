import { describe, expect, it } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { TRACK_EVENT_SPAN_NAME } from "~/server/tracer/constants";
import type { NormalizedSpan } from "../../schemas/spans";
import { NormalizedSpanKind, NormalizedStatusCode } from "../../schemas/spans";
import { SpanTimingService, isValidTimestamp } from "./span-timing.service";

function makeSpan(overrides: Partial<NormalizedSpan> = {}): NormalizedSpan {
  return {
    id: "span-1",
    traceId: "trace-1",
    spanId: "span-1",
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
    statusCode: NormalizedStatusCode.OK,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ...overrides,
  };
}

function makeState(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    spanCount: 0,
    totalDurationMs: 0,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: false,
    errorMessage: null,
    models: [],
    totalCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    attributes: {},
    scenarioRoleCosts: {},
    scenarioRoleLatencies: {},
    scenarioRoleSpans: {},
    spanCosts: {},
    occurredAt: 0,
    createdAt: 0,
    updatedAt: 0,
    lastEventOccurredAt: 0,
    ...overrides,
  };
}

describe("SpanTimingService", () => {
  const service = new SpanTimingService();

  describe("accumulateTiming()", () => {
    describe("when processing a single real span", () => {
      it("computes timing from the span timestamps", () => {
        const result = service.accumulateTiming({
          state: makeState(),
          span: makeSpan({ startTimeUnixMs: 5000, endTimeUnixMs: 7000 }),
        });

        expect(result.occurredAt).toBe(5000);
        expect(result.totalDurationMs).toBe(2000);
      });
    });

    describe("when processing multiple sequential spans", () => {
      it("computes wall-clock time from earliest start to latest end", () => {
        let state = makeState();

        const first = service.accumulateTiming({
          state,
          span: makeSpan({ startTimeUnixMs: 1000, endTimeUnixMs: 2000 }),
        });
        state = makeState({
          occurredAt: first.occurredAt,
          totalDurationMs: first.totalDurationMs,
        });

        const result = service.accumulateTiming({
          state,
          span: makeSpan({ startTimeUnixMs: 3000, endTimeUnixMs: 5000 }),
        });

        expect(result.occurredAt).toBe(1000);
        expect(result.totalDurationMs).toBe(4000);
      });
    });

    describe("when a langwatch.track_event span is present", () => {
      it("excludes synthetic span from timing calculation", () => {
        let state = makeState();

        const first = service.accumulateTiming({
          state,
          span: makeSpan({ startTimeUnixMs: 1000, endTimeUnixMs: 2600 }),
        });
        state = makeState({
          occurredAt: first.occurredAt,
          totalDurationMs: first.totalDurationMs,
        });

        const result = service.accumulateTiming({
          state,
          span: makeSpan({
            name: TRACK_EVENT_SPAN_NAME,
            startTimeUnixMs: 19000,
            endTimeUnixMs: 19000,
          }),
        });

        expect(result.occurredAt).toBe(1000);
        expect(result.totalDurationMs).toBe(1600);
      });

      it("does not inflate timing when track_event is the only span", () => {
        const result = service.accumulateTiming({
          state: makeState(),
          span: makeSpan({
            name: TRACK_EVENT_SPAN_NAME,
            startTimeUnixMs: 50000,
            endTimeUnixMs: 50000,
          }),
        });

        expect(result.occurredAt).toBe(0);
        expect(result.totalDurationMs).toBe(0);
      });
    });

    describe("when span has invalid timestamps", () => {
      it("returns unchanged state", () => {
        const state = makeState({ occurredAt: 1000, totalDurationMs: 500 });

        const result = service.accumulateTiming({
          state,
          span: makeSpan({ startTimeUnixMs: 0, endTimeUnixMs: 0 }),
        });

        expect(result.occurredAt).toBe(1000);
        expect(result.totalDurationMs).toBe(500);
      });
    });
  });

  describe("isValidTimestamp()", () => {
    it.each([null, undefined, 0, -1, Infinity, NaN])(
      "rejects %s",
      (value) => {
        expect(isValidTimestamp(value as number | null | undefined)).toBe(
          false,
        );
      },
    );

    it.each([1, 1713000000000])("accepts %d", (value) => {
      expect(isValidTimestamp(value)).toBe(true);
    });
  });
});
