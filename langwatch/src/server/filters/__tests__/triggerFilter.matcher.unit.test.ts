import { describe, expect, it } from "vitest";
import type { PreconditionTraceData } from "../precondition-matchers";
import type { TriggerFilters } from "../types";
import {
  buildPreconditionTraceDataFromFoldState,
  classifyTriggerFilters,
  matchesTriggerFilters,
} from "../triggerFilter.matcher";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";

function makeTraceData(
  overrides: Partial<PreconditionTraceData> = {},
): PreconditionTraceData {
  return {
    input: "hello",
    output: "world",
    origin: "application",
    hasError: false,
    userId: "user-1",
    threadId: "thread-1",
    customerId: "customer-1",
    labels: ["prod"],
    promptIds: null,
    topicId: null,
    subTopicId: null,
    spanModels: ["gpt-4"],
    customMetadata: { env: "production" },
    annotationIds: [],
    ...overrides,
  };
}

describe("matchesTriggerFilters", () => {
  describe("when filters are empty", () => {
    it("returns true", () => {
      const data = makeTraceData();
      expect(matchesTriggerFilters(data, {})).toBe(true);
    });
  });

  describe("when filtering by traces.origin", () => {
    it("matches when origin is in filter values", () => {
      const data = makeTraceData({ origin: "application" });
      const filters: TriggerFilters = {
        "traces.origin": ["application", "playground"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when origin is not in filter values", () => {
      const data = makeTraceData({ origin: "playground" });
      const filters: TriggerFilters = { "traces.origin": ["application"] };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filtering by traces.error", () => {
    it("matches error traces", () => {
      const data = makeTraceData({ hasError: true });
      const filters: TriggerFilters = { "traces.error": ["true"] };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match non-error traces", () => {
      const data = makeTraceData({ hasError: false });
      const filters: TriggerFilters = { "traces.error": ["true"] };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filtering by spans.model", () => {
    it("matches when any model is in filter values", () => {
      const data = makeTraceData({ spanModels: ["gpt-4", "gpt-5-mini"] });
      const filters: TriggerFilters = { "spans.model": ["gpt-5-mini"] };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when no model matches", () => {
      const data = makeTraceData({ spanModels: ["gpt-4"] });
      const filters: TriggerFilters = { "spans.model": ["claude-3"] };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });

    it("does not match when spanModels is null", () => {
      const data = makeTraceData({ spanModels: null });
      const filters: TriggerFilters = { "spans.model": ["gpt-4"] };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filtering by metadata.user_id", () => {
    it("matches when userId is in filter values", () => {
      const data = makeTraceData({ userId: "alice" });
      const filters: TriggerFilters = {
        "metadata.user_id": ["alice", "bob"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when userId is not in filter values", () => {
      const data = makeTraceData({ userId: "charlie" });
      const filters: TriggerFilters = {
        "metadata.user_id": ["alice", "bob"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filtering by metadata.labels", () => {
    it("matches when any label is in filter values", () => {
      const data = makeTraceData({ labels: ["prod", "v2"] });
      const filters: TriggerFilters = { "metadata.labels": ["v2"] };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when no labels overlap", () => {
      const data = makeTraceData({ labels: ["staging"] });
      const filters: TriggerFilters = { "metadata.labels": ["prod"] };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filtering by metadata.value (keyed)", () => {
    it("matches keyed metadata value", () => {
      const data = makeTraceData({ customMetadata: { env: "production" } });
      const filters: TriggerFilters = {
        "metadata.value": { env: ["production"] },
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when key exists but value differs", () => {
      const data = makeTraceData({ customMetadata: { env: "staging" } });
      const filters: TriggerFilters = {
        "metadata.value": { env: ["production"] },
      };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filtering by topics.topics", () => {
    it("matches when topicId is in filter values", () => {
      const data = makeTraceData({ topicId: "topic-1" });
      const filters: TriggerFilters = {
        "topics.topics": ["topic-1", "topic-2"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when topicId is null", () => {
      const data = makeTraceData({ topicId: null });
      const filters: TriggerFilters = { "topics.topics": ["topic-1"] };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when combining multiple filters (AND semantics)", () => {
    it("matches when all filters pass", () => {
      const data = makeTraceData({
        origin: "application",
        hasError: true,
        spanModels: ["gpt-4"],
      });
      const filters: TriggerFilters = {
        "traces.origin": ["application"],
        "traces.error": ["true"],
        "spans.model": ["gpt-4"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when one filter fails", () => {
      const data = makeTraceData({
        origin: "application",
        hasError: false,
        spanModels: ["gpt-4"],
      });
      const filters: TriggerFilters = {
        "traces.origin": ["application"],
        "traces.error": ["true"],
        "spans.model": ["gpt-4"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filters contain evaluation fields", () => {
    it("returns false", () => {
      const data = makeTraceData();
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-1": ["true"] },
      };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filter values are empty arrays", () => {
    it("treats empty array as pass-through", () => {
      const data = makeTraceData();
      const filters: TriggerFilters = { "traces.origin": [] };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });
  });

  describe("when filters contain unsupported fields", () => {
    it("skips metadata.key (key-selector) without failing", () => {
      const data = makeTraceData({ origin: "application" });
      const filters: TriggerFilters = {
        "traces.origin": ["application"],
        "metadata.key": ["some_key"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("skips events.metrics.value (numeric-only) without failing", () => {
      const data = makeTraceData();
      const filters: TriggerFilters = {
        "events.metrics.value": { click: { count: ["5"] } },
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });
  });
});

describe("classifyTriggerFilters", () => {
  it("separates trace and evaluation filters", () => {
    const filters: TriggerFilters = {
      "traces.origin": ["application"],
      "spans.model": ["gpt-4"],
      "evaluations.passed": { "eval-1": ["true"] },
      "evaluations.score": { "eval-1": { score: ["0.5"] } },
    };

    const result = classifyTriggerFilters(filters);

    expect(Object.keys(result.traceFilters)).toEqual([
      "traces.origin",
      "spans.model",
    ]);
    expect(Object.keys(result.evaluationFilters)).toEqual([
      "evaluations.passed",
      "evaluations.score",
    ]);
    expect(result.hasEvaluationFilters).toBe(true);
  });

  it("reports no evaluation filters when absent", () => {
    const filters: TriggerFilters = {
      "traces.origin": ["application"],
    };

    const result = classifyTriggerFilters(filters);
    expect(result.hasEvaluationFilters).toBe(false);
  });
});

describe("buildPreconditionTraceDataFromFoldState", () => {
  it("extracts fields from fold state attributes", () => {
    const foldState = {
      traceId: "trace-1",
      spanCount: 3,
      totalDurationMs: 1000,
      computedIOSchemaVersion: "1",
      computedInput: "hello world",
      computedOutput: "goodbye world",
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: true,
      containsOKStatus: false,
      errorMessage: "boom",
      models: ["gpt-4", "gpt-5-mini"],
      totalCost: 0.01,
      tokensEstimated: false,
      totalPromptTokenCount: 100,
      totalCompletionTokenCount: 50,
      outputFromRootSpan: true,
      outputSpanEndTimeMs: 1000,
      blockedByGuardrail: false,
      topicId: "topic-1",
      subTopicId: "subtopic-1",
      annotationIds: ["ann-1"],
      attributes: {
        "langwatch.origin": "application",
        "langwatch.user_id": "user-42",
        "gen_ai.conversation.id": "thread-7",
        "langwatch.customer_id": "cust-99",
        "langwatch.labels": '["prod","v2"]',
        "langwatch.prompt_ids": '["prompt-1"]',
        "metadata.custom_field": "custom_value",
      },
      occurredAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastEventOccurredAt: Date.now(),
    } as TraceSummaryData;

    const result = buildPreconditionTraceDataFromFoldState(foldState);

    expect(result.input).toBe("hello world");
    expect(result.output).toBe("goodbye world");
    expect(result.origin).toBe("application");
    expect(result.hasError).toBe(true);
    expect(result.userId).toBe("user-42");
    expect(result.threadId).toBe("thread-7");
    expect(result.customerId).toBe("cust-99");
    expect(result.labels).toEqual(["prod", "v2"]);
    expect(result.promptIds).toEqual(["prompt-1"]);
    expect(result.topicId).toBe("topic-1");
    expect(result.subTopicId).toBe("subtopic-1");
    expect(result.spanModels).toEqual(["gpt-4", "gpt-5-mini"]);
    expect(result.customMetadata).toEqual({ custom_field: "custom_value" });
    expect(result.annotationIds).toEqual(["ann-1"]);
  });
});
