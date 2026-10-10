import { ATTR_KEYS } from "@langwatch/span-normalisation";
import { describe, expect, it } from "vitest";

import {
  accumulateSpanTiming,
  addReservedTokenSum,
  extractSpanStatus,
  foldSpanIntoTraceAnalytics,
  mergeModelsMostRecentFirst,
  NormalizedSpanKind,
  NormalizedStatusCode,
  type NormalizedSpan,
  parseJsonStringArray,
  RESERVED_CACHE_READ_TOKENS,
  resolveTraceNameFromSpan,
  type TraceSummaryData,
} from "../../../index.ts";

function span(overrides: Partial<NormalizedSpan> = {}): NormalizedSpan {
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
    durationMs: 1000.4,
    name: "test-span",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: {},
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.UNSET,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0 as const,
    droppedEventsCount: 0 as const,
    droppedLinksCount: 0 as const,
    cost: null,
    nonBilledCost: null,
    ...overrides,
  };
}

function emptyState(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return {
    traceId: "",
    spanCount: 0,
    totalDurationMs: 0,
    computedIOSchemaVersion: "",
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
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    attributes: {},
    traceName: "",
    rootSpanStartTimeMs: undefined,
    traceNameUserOverridden: false,
    traceNameFromFallback: false,
    rootMetadataFromFallback: false,
    occurredAt: 0,
    createdAt: 0,
    updatedAt: 0,
    LastEventOccurredAt: 0,
    ...overrides,
  };
}

describe("foldSpanIntoTraceAnalytics", () => {
  describe("given an empty trace and a priced root span that used a model", () => {
    const next = foldSpanIntoTraceAnalytics({
      state: emptyState(),
      span: span({
        name: "agent-run",
        spanAttributes: {
          [ATTR_KEYS.GEN_AI_REQUEST_MODEL]: "gpt-5",
          [ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]: 5,
        },
      }),
      spanCost: 0.25,
      spanUnpriced: false,
    });

    it("counts the span, names the trace and takes its window", () => {
      expect(next).toMatchObject({
        traceId: "trace-1",
        spanCount: 1,
        traceName: "agent-run",
        traceNameFromFallback: false,
        occurredAt: 1000,
        totalDurationMs: 1000,
        totalCost: 0.25,
      });
    });

    it("records the model and stamps it as trace metadata", () => {
      expect(next.models).toEqual(["gpt-5"]);
      expect(next.attributes["metadata.model"]).toBe("gpt-5");
    });

    it("sums the cache-read tokens on the reserved key", () => {
      expect(next.attributes[RESERVED_CACHE_READ_TOKENS]).toBe("5");
    });
  });

  describe("given a synthetic track-event span", () => {
    it("leaves the state untouched", () => {
      const state = emptyState({ spanCount: 3 });
      expect(
        foldSpanIntoTraceAnalytics({
          state,
          span: span({ name: "langwatch.track_event" }),
          spanCost: 1,
          spanUnpriced: false,
        }),
      ).toBe(state);
    });
  });

  describe("given a span marked to skip token accumulation", () => {
    it("adds no cost even when priced, so the trace stays unpriced", () => {
      const next = foldSpanIntoTraceAnalytics({
        state: emptyState(),
        span: span({
          spanAttributes: { [ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION]: true },
        }),
        spanCost: 2,
        spanUnpriced: false,
      });
      expect(next.totalCost).toBeNull();
    });
  });
});

describe("mergeModelsMostRecentFirst", () => {
  it("puts the incoming models first without repeating them", () => {
    expect(
      mergeModelsMostRecentFirst({ existing: ["a", "b"], incoming: ["b", "c", "", "c"] }),
    ).toEqual(["b", "c", "a"]);
  });
});

describe("addReservedTokenSum", () => {
  it("adds a positive delta and ignores a non-positive one", () => {
    const attributes: Record<string, string> = { k: "2" };
    addReservedTokenSum({ attributes, key: "k", delta: 3 });
    addReservedTokenSum({ attributes, key: "k", delta: 0 });
    expect(attributes.k).toBe("5");
  });
});

describe("accumulateSpanTiming", () => {
  it("never yields a negative duration from a clock that ran backwards", () => {
    expect(
      accumulateSpanTiming({
        state: emptyState(),
        span: span({ startTimeUnixMs: 5000, endTimeUnixMs: 4000 }),
      }),
    ).toEqual({ occurredAt: 5000, totalDurationMs: 0 });
  });
});

describe("extractSpanStatus", () => {
  it("prefers the latest exception event's message over the status message", () => {
    expect(
      extractSpanStatus(
        span({
          statusCode: NormalizedStatusCode.ERROR,
          statusMessage: "500",
          events: [
            { name: "exception", timeUnixMs: 1500, attributes: { "exception.message": "boom" } },
          ],
        }),
      ),
    ).toEqual({ hasError: true, hasOK: false, errorMessage: "boom" });
  });
});

describe("resolveTraceNameFromSpan", () => {
  it("lets a real root replace a fallback name", () => {
    const fallback = resolveTraceNameFromSpan({
      state: emptyState(),
      span: span({ name: "child", parentSpanId: "missing", startTimeUnixMs: 900 }),
    });
    expect(fallback).toMatchObject({ traceName: "child", traceNameFromFallback: true });

    const root = resolveTraceNameFromSpan({
      state: emptyState({ ...fallback, traceName: fallback.traceName }),
      span: span({ name: "root" }),
    });
    expect(root).toMatchObject({ traceName: "root", traceNameFromFallback: false });
  });
});

describe("parseJsonStringArray", () => {
  it("drops a truncated array rather than nesting it", () => {
    expect(parseJsonStringArray('["a", "b')).toEqual([]);
  });
});
