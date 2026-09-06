import { describe, expect, it } from "vitest";
import type { TraceSummaryData } from "@langwatch/trace-contract";
const TRACK_EVENT_SPAN_NAME = "langwatch.track_event";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import { NormalizedSpanKind, NormalizedStatusCode } from "@langwatch/trace-contract";
import { SpanTimingService } from "../span-timing.service";
import { isValidTimestamp } from "../../rules/span-timing.rules";

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
    cost: null,
    nonBilledCost: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return {
    traceId: "trace-1",
    traceName: "",
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
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    attributes: {},
    occurredAt: 0,
    createdAt: 0,
    updatedAt: 0,
    LastEventOccurredAt: 0,
    ...overrides,
  };
}

describe("SpanTimingService", () => {
  const service = SpanTimingService.create();

  describe("accumulateTiming()", () => {
    describe("when processing a single real span", () => {
      /** @scenario "A single span sets the trace start and duration" */
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
      /** @scenario "Several spans give the wall clock from earliest start to latest end" */
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
      /** @scenario "A synthetic event span does not stretch the trace" */
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

      /** @scenario "A synthetic event span does not stretch the trace" */
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
      /** @scenario "A span with unusable timestamps leaves the trace timing alone" */
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
    describe("when a span arrives out of order, starting before the trace did", () => {
      /** @scenario "Several spans give the wall clock from earliest start to latest end" */
      it("pulls the start back and keeps the end the later span already set", () => {
        const state = makeState({ occurredAt: 2000, totalDurationMs: 500 });

        const result = service.accumulateTiming({
          state,
          span: makeSpan({ startTimeUnixMs: 1000, endTimeUnixMs: 1200 }),
        });

        expect(result.occurredAt).toBe(1000);
        expect(result.totalDurationMs).toBe(1500);
      });
    });

    describe("when a span carries an infinite or not-a-number time", () => {
      /** @scenario "A span with unusable timestamps leaves the trace timing alone" */
      it.each([
        ["infinite end", 1000, Number.POSITIVE_INFINITY],
        ["not-a-number end", 1000, Number.NaN],
        ["not-a-number start", Number.NaN, 2000],
        ["negative start", -1000, 2000],
      ])("leaves the trace timing alone for a span with an %s", (_label, start, end) => {
        const state = makeState({ occurredAt: 1000, totalDurationMs: 500 });

        const result = service.accumulateTiming({
          state,
          span: makeSpan({ startTimeUnixMs: start, endTimeUnixMs: end }),
        });

        expect(result.occurredAt).toBe(1000);
        expect(result.totalDurationMs).toBe(500);
      });
    });

    describe("when a span ends before it starts", () => {
      /** @scenario "A span that ends before it starts does not give the trace a negative duration" */
      it("reports no duration rather than a negative one", () => {
        const result = service.accumulateTiming({
          state: makeState(),
          span: makeSpan({ startTimeUnixMs: 5000, endTimeUnixMs: 4000 }),
        });

        expect(result.occurredAt).toBe(5000);
        expect(result.totalDurationMs).toBe(0);
      });

      /** @scenario "A span that ends before it starts does not give the trace a negative duration" */
      it("does not shorten a trace a real span had already timed", () => {
        const state = makeState({ occurredAt: 1000, totalDurationMs: 4000 });

        const result = service.accumulateTiming({
          state,
          span: makeSpan({ startTimeUnixMs: 500, endTimeUnixMs: 400 }),
        });

        expect(result.occurredAt).toBe(500);
        expect(result.totalDurationMs).toBe(4500);
      });
    });

    describe("when a span starts and ends at the same instant", () => {
      /** @scenario "A span that starts and ends at the same instant lasts no time" */
      it("gives the trace a start and no duration", () => {
        const result = service.accumulateTiming({
          state: makeState(),
          span: makeSpan({ startTimeUnixMs: 5000, endTimeUnixMs: 5000 }),
        });

        expect(result.occurredAt).toBe(5000);
        expect(result.totalDurationMs).toBe(0);
      });
    });
  });

  describe("isValidTimestamp()", () => {
    it.each([null, undefined, 0, -1, Infinity, NaN])("rejects %s", (value) => {
      expect(isValidTimestamp(value as number | null | undefined)).toBe(false);
    });

    it.each([1, 1713000000000])("accepts %d", (value) => {
      expect(isValidTimestamp(value)).toBe(true);
    });
  });
});
