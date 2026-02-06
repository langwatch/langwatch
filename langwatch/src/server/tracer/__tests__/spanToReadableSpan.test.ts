import { describe, expect, it } from "vitest";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { langwatchSpanToReadableSpan } from "../spanToReadableSpan";
import type {
  BaseSpan,
  LLMSpan,
  RAGSpan,
  Span,
  SpanTypes,
} from "../types";

function makeBaseSpan(overrides: Partial<BaseSpan> = {}): BaseSpan {
  return {
    span_id: "span-1",
    trace_id: "trace-1",
    type: "span",
    name: "test-span",
    timestamps: {
      started_at: 1700000000000,
      finished_at: 1700000001500,
    },
    input: null,
    output: null,
    error: null,
    metrics: null,
    params: null,
    ...overrides,
  };
}

function makeLLMSpan(overrides: Partial<LLMSpan> = {}): LLMSpan {
  return {
    ...makeBaseSpan(),
    type: "llm",
    model: "gpt-4o",
    vendor: "openai",
    ...overrides,
  };
}

function makeRAGSpan(overrides: Partial<RAGSpan> = {}): RAGSpan {
  return {
    ...makeBaseSpan(),
    type: "rag",
    contexts: [
      { document_id: "doc-1", chunk_id: "chunk-1", content: "some content" },
    ],
    ...overrides,
  };
}

describe("langwatchSpanToReadableSpan", () => {
  describe("identity fields", () => {
    it("maps span_id to spanContext().spanId", () => {
      const span = makeBaseSpan({ span_id: "abc-123" });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.spanContext().spanId).toBe("abc-123");
    });

    it("maps trace_id to spanContext().traceId", () => {
      const span = makeBaseSpan({ trace_id: "trace-xyz" });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.spanContext().traceId).toBe("trace-xyz");
    });

    it("sets traceFlags to SAMPLED", () => {
      const result = langwatchSpanToReadableSpan(makeBaseSpan());
      expect(result.spanContext().traceFlags).toBe(1); // TraceFlags.SAMPLED
    });
  });

  describe("parent hierarchy", () => {
    it("maps parent_id to parentSpanContext.spanId", () => {
      const span = makeBaseSpan({ parent_id: "parent-1" });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.parentSpanContext).toBeDefined();
      expect(result.parentSpanContext!.spanId).toBe("parent-1");
      expect(result.parentSpanContext!.traceId).toBe("trace-1");
    });

    it("sets parentSpanContext undefined for root spans", () => {
      const span = makeBaseSpan({ parent_id: null });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.parentSpanContext).toBeUndefined();
    });

    it("sets parentSpanContext undefined when parent_id is absent", () => {
      const span = makeBaseSpan();
      delete (span as any).parent_id;
      const result = langwatchSpanToReadableSpan(span);
      expect(result.parentSpanContext).toBeUndefined();
    });
  });

  describe("name", () => {
    it("uses span name", () => {
      const span = makeBaseSpan({ name: "my-operation" });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.name).toBe("my-operation");
    });

    it("defaults to empty string when name is null", () => {
      const span = makeBaseSpan({ name: null });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.name).toBe("");
    });

    it("defaults to empty string when name is undefined", () => {
      const span = makeBaseSpan({ name: undefined });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.name).toBe("");
    });
  });

  describe("timestamps", () => {
    it("converts started_at (ms) to HrTime [seconds, nanoseconds]", () => {
      const span = makeBaseSpan({
        timestamps: { started_at: 1700000001500, finished_at: 1700000002000 },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.startTime).toEqual([1700000001, 500_000_000]);
    });

    it("converts finished_at (ms) to HrTime", () => {
      const span = makeBaseSpan({
        timestamps: { started_at: 1700000000000, finished_at: 1700000002750 },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.endTime).toEqual([1700000002, 750_000_000]);
    });

    it("calculates duration correctly", () => {
      const span = makeBaseSpan({
        timestamps: { started_at: 1700000000000, finished_at: 1700000001500 },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.duration).toEqual([1, 500_000_000]);
    });

    it("handles exact second timestamps", () => {
      const span = makeBaseSpan({
        timestamps: { started_at: 1700000000000, finished_at: 1700000003000 },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.startTime).toEqual([1700000000, 0]);
      expect(result.endTime).toEqual([1700000003, 0]);
      expect(result.duration).toEqual([3, 0]);
    });

    it("handles zero-duration span", () => {
      const span = makeBaseSpan({
        timestamps: { started_at: 1700000000000, finished_at: 1700000000000 },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.duration).toEqual([0, 0]);
    });
  });

  describe("span type to kind mapping", () => {
    const testCases: [SpanTypes, SpanKind][] = [
      ["server", SpanKind.SERVER],
      ["client", SpanKind.CLIENT],
      ["producer", SpanKind.PRODUCER],
      ["consumer", SpanKind.CONSUMER],
      ["span", SpanKind.INTERNAL],
      ["llm", SpanKind.INTERNAL],
      ["chain", SpanKind.INTERNAL],
      ["tool", SpanKind.INTERNAL],
      ["agent", SpanKind.INTERNAL],
      ["rag", SpanKind.INTERNAL],
      ["guardrail", SpanKind.INTERNAL],
      ["evaluation", SpanKind.INTERNAL],
      ["workflow", SpanKind.INTERNAL],
      ["component", SpanKind.INTERNAL],
      ["module", SpanKind.INTERNAL],
      ["task", SpanKind.INTERNAL],
      ["unknown", SpanKind.INTERNAL],
    ];

    it.each(testCases)("maps type '%s' to SpanKind %s", (type, expectedKind) => {
      const span = makeBaseSpan({ type });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.kind).toBe(expectedKind);
    });

    it("stores original type as langwatch.span.type attribute", () => {
      const span = makeBaseSpan({ type: "agent" });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["langwatch.span.type"]).toBe("agent");
    });
  });

  describe("input mapping", () => {
    it("maps chat_messages input to gen_ai.input.messages", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];
      const span = makeBaseSpan({
        input: { type: "chat_messages", value: messages as any },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.input.messages"]).toBe(
        JSON.stringify(messages),
      );
      expect(result.attributes["input"]).toBeUndefined();
    });

    it("maps text input to input attribute", () => {
      const span = makeBaseSpan({
        input: { type: "text", value: "hello world" },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["input"]).toBe("hello world");
      expect(result.attributes["gen_ai.input.messages"]).toBeUndefined();
    });

    it("maps json input to input attribute as JSON string", () => {
      const span = makeBaseSpan({
        input: { type: "json", value: { key: "val" } },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["input"]).toBe('{"key":"val"}');
    });

    it("maps raw input to input attribute", () => {
      const span = makeBaseSpan({
        input: { type: "raw", value: "raw-content" },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["input"]).toBe("raw-content");
    });

    it("sets no input attribute when input is null", () => {
      const span = makeBaseSpan({ input: null });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["input"]).toBeUndefined();
      expect(result.attributes["gen_ai.input.messages"]).toBeUndefined();
    });

    it("sets no input attribute when input is undefined", () => {
      const span = makeBaseSpan({ input: undefined });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["input"]).toBeUndefined();
    });
  });

  describe("output mapping", () => {
    it("maps chat_messages output to gen_ai.output.messages", () => {
      const messages = [{ role: "assistant", content: "Response" }];
      const span = makeBaseSpan({
        output: { type: "chat_messages", value: messages as any },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.output.messages"]).toBe(
        JSON.stringify(messages),
      );
      expect(result.attributes["output"]).toBeUndefined();
    });

    it("maps text output to output attribute", () => {
      const span = makeBaseSpan({
        output: { type: "text", value: "result text" },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["output"]).toBe("result text");
    });

    it("maps json output to output attribute as JSON string", () => {
      const span = makeBaseSpan({
        output: { type: "json", value: [1, 2, 3] },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["output"]).toBe("[1,2,3]");
    });

    it("maps raw output to output attribute", () => {
      const span = makeBaseSpan({
        output: { type: "raw", value: "raw-output" },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["output"]).toBe("raw-output");
    });

    it("sets no output attribute when output is null", () => {
      const span = makeBaseSpan({ output: null });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["output"]).toBeUndefined();
      expect(result.attributes["gen_ai.output.messages"]).toBeUndefined();
    });
  });

  describe("LLM span fields", () => {
    it("maps model to gen_ai.request.model", () => {
      const span = makeLLMSpan({ model: "gpt-4o" });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.request.model"]).toBe("gpt-4o");
    });

    it("maps vendor to gen_ai.system", () => {
      const span = makeLLMSpan({ vendor: "openai" });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.system"]).toBe("openai");
    });

    it("omits model attribute when null", () => {
      const span = makeLLMSpan({ model: null });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.request.model"]).toBeUndefined();
    });

    it("omits vendor attribute when null", () => {
      const span = makeLLMSpan({ vendor: null });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.system"]).toBeUndefined();
    });
  });

  describe("params mapping", () => {
    it("maps temperature to gen_ai.request.temperature", () => {
      const span = makeBaseSpan({ params: { temperature: 0.7 } });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.request.temperature"]).toBe(0.7);
    });

    it("maps max_tokens to gen_ai.request.max_tokens", () => {
      const span = makeBaseSpan({ params: { max_tokens: 1024 } });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.request.max_tokens"]).toBe(1024);
    });

    it("maps top_p to gen_ai.request.top_p", () => {
      const span = makeBaseSpan({ params: { top_p: 0.9 } });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.request.top_p"]).toBe(0.9);
    });

    it("omits param attributes when params is null", () => {
      const span = makeBaseSpan({ params: null });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.request.temperature"]).toBeUndefined();
      expect(result.attributes["gen_ai.request.max_tokens"]).toBeUndefined();
      expect(result.attributes["gen_ai.request.top_p"]).toBeUndefined();
    });

    it("omits individual param when null", () => {
      const span = makeBaseSpan({
        params: { temperature: null, max_tokens: 100 },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.request.temperature"]).toBeUndefined();
      expect(result.attributes["gen_ai.request.max_tokens"]).toBe(100);
    });
  });

  describe("metrics mapping", () => {
    it("maps prompt_tokens", () => {
      const span = makeBaseSpan({
        metrics: { prompt_tokens: 100, completion_tokens: null },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.usage.prompt_tokens"]).toBe(100);
    });

    it("maps completion_tokens", () => {
      const span = makeBaseSpan({
        metrics: { completion_tokens: 50 },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.usage.completion_tokens"]).toBe(50);
    });

    it("maps cost", () => {
      const span = makeBaseSpan({
        metrics: { cost: 0.0025 },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.usage.cost"]).toBe(0.0025);
    });

    it("omits metric attributes when metrics is null", () => {
      const span = makeBaseSpan({ metrics: null });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.usage.prompt_tokens"]).toBeUndefined();
      expect(
        result.attributes["gen_ai.usage.completion_tokens"],
      ).toBeUndefined();
      expect(result.attributes["gen_ai.usage.cost"]).toBeUndefined();
    });

    it("omits individual metric when null", () => {
      const span = makeBaseSpan({
        metrics: { prompt_tokens: 100, completion_tokens: null, cost: null },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["gen_ai.usage.prompt_tokens"]).toBe(100);
      expect(
        result.attributes["gen_ai.usage.completion_tokens"],
      ).toBeUndefined();
      expect(result.attributes["gen_ai.usage.cost"]).toBeUndefined();
    });
  });

  describe("RAG span contexts", () => {
    it("maps contexts to retrieval.documents as JSON", () => {
      const contexts = [
        { document_id: "d1", chunk_id: "c1", content: "doc content" },
      ];
      const span = makeRAGSpan({ contexts });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["retrieval.documents"]).toBe(
        JSON.stringify(contexts),
      );
    });

    it("handles multiple contexts", () => {
      const contexts = [
        { document_id: "d1", chunk_id: "c1", content: "first" },
        { document_id: "d2", chunk_id: "c2", content: "second" },
      ];
      const span = makeRAGSpan({ contexts });
      const result = langwatchSpanToReadableSpan(span);
      const parsed = JSON.parse(
        result.attributes["retrieval.documents"] as string,
      );
      expect(parsed).toHaveLength(2);
    });

    it("omits retrieval.documents for non-RAG spans", () => {
      const span = makeBaseSpan();
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["retrieval.documents"]).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("maps error to status code ERROR with message", () => {
      const span = makeBaseSpan({
        error: {
          has_error: true,
          message: "Something went wrong",
          stacktrace: ["line1", "line2"],
        },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.status.code).toBe(SpanStatusCode.ERROR);
      expect(result.status.message).toBe("Something went wrong");
    });

    it("maps no error to status code OK", () => {
      const span = makeBaseSpan({ error: null });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.status.code).toBe(SpanStatusCode.OK);
      expect(result.status.message).toBeUndefined();
    });

    it("maps undefined error to status code OK", () => {
      const span = makeBaseSpan({ error: undefined });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.status.code).toBe(SpanStatusCode.OK);
    });
  });

  describe("stub fields", () => {
    it("returns empty links array", () => {
      const result = langwatchSpanToReadableSpan(makeBaseSpan());
      expect(result.links).toEqual([]);
    });

    it("returns empty events array", () => {
      const result = langwatchSpanToReadableSpan(makeBaseSpan());
      expect(result.events).toEqual([]);
    });

    it("returns ended as true", () => {
      const result = langwatchSpanToReadableSpan(makeBaseSpan());
      expect(result.ended).toBe(true);
    });

    it("returns a resource object", () => {
      const result = langwatchSpanToReadableSpan(makeBaseSpan());
      expect(result.resource).toBeDefined();
      expect(result.resource.attributes).toBeDefined();
    });

    it("returns instrumentationScope with name 'langwatch'", () => {
      const result = langwatchSpanToReadableSpan(makeBaseSpan());
      expect(result.instrumentationScope.name).toBe("langwatch");
    });

    it("returns zero dropped counts", () => {
      const result = langwatchSpanToReadableSpan(makeBaseSpan());
      expect(result.droppedAttributesCount).toBe(0);
      expect(result.droppedEventsCount).toBe(0);
      expect(result.droppedLinksCount).toBe(0);
    });
  });

  describe("complete LLM span", () => {
    it("converts a fully-populated LLM span with all fields", () => {
      const span: LLMSpan = {
        span_id: "llm-span-1",
        parent_id: "parent-span-1",
        trace_id: "trace-abc",
        type: "llm",
        name: "gpt-4o-call",
        model: "gpt-4o",
        vendor: "openai",
        input: {
          type: "chat_messages",
          value: [
            { role: "system", content: "You are helpful." },
            { role: "user", content: "Hi" },
          ],
        },
        output: {
          type: "chat_messages",
          value: [{ role: "assistant", content: "Hello!" }],
        },
        error: null,
        timestamps: {
          started_at: 1700000000000,
          finished_at: 1700000002500,
        },
        metrics: {
          prompt_tokens: 15,
          completion_tokens: 5,
          cost: 0.001,
        },
        params: {
          temperature: 0.5,
          max_tokens: 256,
          top_p: 0.95,
        },
      };

      const result = langwatchSpanToReadableSpan(span);

      expect(result.name).toBe("gpt-4o-call");
      expect(result.kind).toBe(SpanKind.INTERNAL);
      expect(result.spanContext().spanId).toBe("llm-span-1");
      expect(result.spanContext().traceId).toBe("trace-abc");
      expect(result.parentSpanContext?.spanId).toBe("parent-span-1");
      expect(result.startTime).toEqual([1700000000, 0]);
      expect(result.endTime).toEqual([1700000002, 500_000_000]);
      expect(result.duration).toEqual([2, 500_000_000]);
      expect(result.status.code).toBe(SpanStatusCode.OK);
      expect(result.attributes["langwatch.span.type"]).toBe("llm");
      expect(result.attributes["gen_ai.request.model"]).toBe("gpt-4o");
      expect(result.attributes["gen_ai.system"]).toBe("openai");
      expect(result.attributes["gen_ai.request.temperature"]).toBe(0.5);
      expect(result.attributes["gen_ai.request.max_tokens"]).toBe(256);
      expect(result.attributes["gen_ai.request.top_p"]).toBe(0.95);
      expect(result.attributes["gen_ai.usage.prompt_tokens"]).toBe(15);
      expect(result.attributes["gen_ai.usage.completion_tokens"]).toBe(5);
      expect(result.attributes["gen_ai.usage.cost"]).toBe(0.001);
      expect(result.attributes["gen_ai.input.messages"]).toBeDefined();
      expect(result.attributes["gen_ai.output.messages"]).toBeDefined();
    });
  });

  describe("complete RAG span", () => {
    it("converts a fully-populated RAG span with all fields", () => {
      const span: RAGSpan = {
        span_id: "rag-span-1",
        trace_id: "trace-rag",
        type: "rag",
        name: "retrieve-docs",
        input: { type: "text", value: "search query" },
        output: { type: "json", value: { results: 3 } },
        error: null,
        timestamps: {
          started_at: 1700000000000,
          finished_at: 1700000000500,
        },
        metrics: null,
        params: null,
        contexts: [
          { document_id: "d1", chunk_id: "c1", content: "chunk 1" },
          { document_id: "d2", chunk_id: "c2", content: "chunk 2" },
        ],
      };

      const result = langwatchSpanToReadableSpan(span);

      expect(result.name).toBe("retrieve-docs");
      expect(result.attributes["langwatch.span.type"]).toBe("rag");
      expect(result.attributes["input"]).toBe("search query");
      expect(result.attributes["output"]).toBe('{"results":3}');
      expect(result.attributes["retrieval.documents"]).toBeDefined();
      const docs = JSON.parse(
        result.attributes["retrieval.documents"] as string,
      );
      expect(docs).toHaveLength(2);
    });
  });

  describe("error span", () => {
    it("converts a span with an error status", () => {
      const span = makeBaseSpan({
        name: "failing-operation",
        error: {
          has_error: true,
          message: "Connection timeout",
          stacktrace: ["at fn1 (file.ts:10)", "at fn2 (file.ts:20)"],
        },
      });

      const result = langwatchSpanToReadableSpan(span);

      expect(result.status.code).toBe(SpanStatusCode.ERROR);
      expect(result.status.message).toBe("Connection timeout");
    });
  });

  describe("edge cases", () => {
    it("handles empty spans array via map", () => {
      const spans: Span[] = [];
      const results = spans.map(langwatchSpanToReadableSpan);
      expect(results).toEqual([]);
    });

    it("handles multiple spans conversion", () => {
      const spans: Span[] = [
        makeBaseSpan({ span_id: "s1", name: "first" }),
        makeBaseSpan({ span_id: "s2", name: "second", parent_id: "s1" }),
      ];
      const results = spans.map(langwatchSpanToReadableSpan);
      expect(results).toHaveLength(2);
      expect(results[0]!.name).toBe("first");
      expect(results[1]!.name).toBe("second");
      expect(results[1]!.parentSpanContext?.spanId).toBe("s1");
    });

    it("handles json input with array value", () => {
      const span = makeBaseSpan({
        input: { type: "json", value: [1, "two", { three: 3 }] },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["input"]).toBe('[1,"two",{"three":3}]');
    });

    it("handles json input with null value", () => {
      const span = makeBaseSpan({
        input: { type: "json", value: null },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["input"]).toBe("null");
    });

    it("handles json output with string value", () => {
      const span = makeBaseSpan({
        output: { type: "json", value: "just a string" },
      });
      const result = langwatchSpanToReadableSpan(span);
      expect(result.attributes["output"]).toBe('"just a string"');
    });
  });
});
