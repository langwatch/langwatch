import { NormalizedStatusCode } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  collectDroppedCategories,
  deserializeStoredAttributes,
  extractFullRecordEvents,
  mapNormalizedSpanToFullRecordSpan,
  mapStoredSpanRow,
  mapTraceMetadata,
  type StoredSpanRow,
} from "../trace-full-record.mapper";

const row = (): StoredSpanRow => ({
  SpanId: "span-1",
  TraceId: "trace-1",
  TenantId: "project-1",
  ParentSpanId: null,
  ParentTraceId: null,
  ParentIsRemote: null,
  Sampled: true,
  StartTimeMs: 10,
  EndTimeMs: 20,
  DurationMs: 10,
  SpanName: "answer",
  SpanKind: 1,
  ResourceAttributes: {},
  SpanAttributes: {},
  StatusCode: 2,
  StatusMessage: "short status",
  ScopeName: "scope",
  ScopeVersion: "1.0",
  Events_Timestamp: [12, 15],
  Events_Name: ["exception", "event-that-is-not-a-trace-event"],
  Events_Attributes: [
    { "exception.message": "useful failure", "exception.stacktrace": "line one\nline two" },
    {},
  ],
  Links_TraceId: [],
  Links_SpanId: [],
  Links_Attributes: [],
});

describe("Trace full-record mapper", () => {
  it("keeps stored JSON/boolean/number values and maps the legacy span fields", () => {
    const attributes = deserializeStoredAttributes({
      "langwatch.span.type": "llm",
      "langwatch.input": "hello",
      "langwatch.output": '{"answer":"world"}',
      "gen_ai.usage.input_tokens": "3",
      "gen_ai.usage.output_tokens": "5",
      "gen_ai.response.model": "gpt-test",
      "gen_ai.provider.name": "openai",
      "event.type": "feedback",
      "event.metrics.score": "1",
      "event.details.source": "human",
      "langwatch.privacy.dropped": "input, tools",
    });
    const normalized = mapStoredSpanRow(row(), attributes);
    const span = mapNormalizedSpanToFullRecordSpan(normalized);

    expect(span).toMatchObject({
      type: "llm",
      input: { type: "text", value: "hello" },
      output: { type: "json", value: { answer: "world" } },
      model: "gpt-test",
      vendor: "openai",
      metrics: { prompt_tokens: 3, completion_tokens: 5 },
      error: {
        has_error: true,
        message: "useful failure",
        stacktrace: ["line one", "line two"],
      },
      timestamps: { started_at: 10, first_token_at: null, finished_at: 20 },
    });
    expect(collectDroppedCategories([normalized])).toEqual(["input", "tools"]);
  });

  it("derives only canonical event.* spans with stable identity and span timestamps", () => {
    const normalized = mapStoredSpanRow(
      row(),
      deserializeStoredAttributes({
        "event.type": "feedback",
        "event.metrics.score": "0.7",
        "event.details.comment": "good",
      }),
    );
    const span = mapNormalizedSpanToFullRecordSpan(normalized);

    expect(
      extractFullRecordEvents({ spans: [span], projectId: "project-1", traceId: "trace-1" }),
    ).toEqual([
      {
        event_id: "span-1",
        event_type: "feedback",
        project_id: "project-1",
        trace_id: "trace-1",
        metrics: { score: 0.7 },
        event_details: { comment: "good" },
        timestamps: { started_at: 10, inserted_at: 10, updated_at: 20 },
      },
    ]);
  });

  it("maps legacy summary metadata aliases without exposing fold bookkeeping", () => {
    expect(
      mapTraceMetadata({
        "gen_ai.conversation.id": "thread-1",
        "langwatch.customer_id": "customer-1",
        "metadata.model": "model-1",
        "metadata.models": '["model-1","model-0"]',
        "langwatch.reserved.model_metadata_stamped": "true",
        "langwatch.reserved.log_record_count": "4",
      }),
    ).toEqual({
      thread_id: "thread-1",
      customer_id: "customer-1",
      model: "model-1",
      models: ["model-1", "model-0"],
      "langwatch.reserved.log_record_count": 4,
      otel_log_record_count: 4,
    });
  });

  it("uses status-code error semantics rather than the status message alone", () => {
    const normalized = mapStoredSpanRow(
      { ...row(), StatusCode: NormalizedStatusCode.OK, StatusMessage: "not an error" },
      deserializeStoredAttributes({}),
    );
    expect(mapNormalizedSpanToFullRecordSpan(normalized).error).toBeNull();
  });
});
