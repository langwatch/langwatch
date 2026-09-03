/**
 * @vitest-environment node
 *
 * Recovered with the projection. A fold state carries the trace flattened into
 * one attribute map, and these pin which key each field is spelled with —
 * including the three legacy custom-metadata spellings and their priority
 * order, which is where a rewrite would quietly disagree with ClickHouse.
 */
import { describe, expect, it } from "vitest";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { PreconditionTraceDataService } from "../precondition-trace-data.service";

const SUBJECT = PreconditionTraceDataService.create();

describe("PreconditionTraceDataService.fromFoldState", () => {
  it("extracts custom metadata from langwatch.metadata.* legacy keys", () => {
    const foldState = {
      traceId: "trace-1",
      traceName: "",
      spanCount: 1,
      totalDurationMs: 100,
      computedIOSchemaVersion: "1",
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
      attributes: {
        "langwatch.origin": "application",
        "langwatch.metadata.env": "production",
        "langwatch.metadata.region": "eu-west-1",
      },
      occurredAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
    } as TraceSummaryData;

    const result = SUBJECT.fromFoldState({ foldState });

    expect(result.customMetadata).toEqual({
      env: "production",
      region: "eu-west-1",
    });
  });

  it("extracts custom metadata from bare OTEL resource attributes", () => {
    const foldState = {
      traceId: "trace-1",
      traceName: "",
      spanCount: 1,
      totalDurationMs: 100,
      computedIOSchemaVersion: "1",
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
      attributes: {
        "langwatch.origin": "application",
        env: "staging",
        region: "us-east-1",
      },
      occurredAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
    } as TraceSummaryData;

    const result = SUBJECT.fromFoldState({ foldState });

    expect(result.customMetadata).toEqual({
      env: "staging",
      region: "us-east-1",
    });
  });

  it("prefers canonical metadata.* over langwatch.metadata.* and bare keys", () => {
    const foldState = {
      traceId: "trace-1",
      traceName: "",
      spanCount: 1,
      totalDurationMs: 100,
      computedIOSchemaVersion: "1",
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
      attributes: {
        "langwatch.origin": "application",
        env: "bare-value",
        "langwatch.metadata.env": "legacy-value",
        "metadata.env": "canonical-value",
      },
      occurredAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
    } as TraceSummaryData;

    const result = SUBJECT.fromFoldState({ foldState });

    expect(result.customMetadata).toEqual({ env: "canonical-value" });
  });

  it("excludes standard OTEL bare-key prefixes from custom metadata", () => {
    const foldState = {
      traceId: "trace-1",
      traceName: "",
      spanCount: 1,
      totalDurationMs: 100,
      computedIOSchemaVersion: "1",
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
      attributes: {
        "langwatch.origin": "application",
        "service.name": "my-app",
        "http.method": "GET",
        "telemetry.sdk.name": "opentelemetry",
        custom_field: "included",
      },
      occurredAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
    } as TraceSummaryData;

    const result = SUBJECT.fromFoldState({ foldState });

    expect(result.customMetadata).toEqual({ custom_field: "included" });
  });

  it("extracts fields from fold state attributes", () => {
    const foldState = {
      traceId: "trace-1",
      traceName: "",
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
      nonBilledCost: null,
      tokensEstimated: false,
      totalPromptTokenCount: 100,
      totalCompletionTokenCount: 50,
      outputFromRootSpan: true,
      outputSpanEndTimeMs: 1000,
      blockedByGuardrail: false,
      rootSpanType: null,
      containsAi: false,
      topicId: "topic-1",
      subTopicId: "subtopic-1",
      annotationIds: ["ann-1"],
      containsPrompt: false,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
      lastUsedPromptStartTimeMs: null,
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
      LastEventOccurredAt: Date.now(),
    } as TraceSummaryData;

    const result = SUBJECT.fromFoldState({ foldState });

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

  it("extracts events from derived events passed in", () => {
    const foldState = {
      traceId: "trace-1",
      traceName: "",
      spanCount: 1,
      totalDurationMs: 100,
      computedIOSchemaVersion: "1",
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
      attributes: { "langwatch.origin": "application" },
      occurredAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
    } as TraceSummaryData;

    const result = SUBJECT.fromFoldState({
      foldState,
      events: [
        {
          spanId: "span-1",
          timestamp: Date.now(),
          name: "thumbs_up_down",
          attributes: {
            "event.type": "thumbs_up_down",
            "event.metrics.score": "1",
            "event.details.page": "/chat",
          },
        },
      ],
    });

    expect(result.events).toHaveLength(1);
    expect(result.events![0]!.event_type).toBe("thumbs_up_down");
    expect(result.events![0]!.metrics).toEqual([{ key: "score", value: 1 }]);
    expect(result.events![0]!.event_details).toEqual([{ key: "page", value: "/chat" }]);
  });
});
