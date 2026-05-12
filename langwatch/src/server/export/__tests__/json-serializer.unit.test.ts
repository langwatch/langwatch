/**
 * @vitest-environment node
 *
 * Unit tests for JSON (JSONL) serializers (summary and full mode).
 * Pure function tests — no mocking needed.
 */

import { describe, expect, it } from "vitest";
import type { Trace, Evaluation, LLMSpan, RAGSpan } from "~/server/tracer/types";
import {
  serializeTraceToSummaryJson,
  serializeTraceToFullJson,
} from "../serializers/json-serializer";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function buildTrace(overrides?: Partial<Trace>): Trace {
  return {
    trace_id: "trace-1",
    project_id: "proj-1",
    metadata: {
      labels: ["production"],
      topic_id: "topic-1",
      subtopic_id: "subtopic-1",
    },
    timestamps: {
      started_at: 1700000000000,
      inserted_at: 1700000001000,
      updated_at: 1700000002000,
    },
    input: { value: "Hello world" },
    output: { value: "Hi there" },
    metrics: {
      first_token_ms: 100,
      total_time_ms: 500,
      prompt_tokens: 10,
      completion_tokens: 20,
      total_cost: 0.001,
    },
    spans: [],
    evaluations: [],
    ...overrides,
  };
}

function buildEvaluation(overrides?: Partial<Evaluation>): Evaluation {
  return {
    evaluation_id: "eval-1",
    evaluator_id: "evaluator-1",
    name: "Faithfulness",
    status: "processed",
    passed: true,
    score: 0.95,
    label: "good",
    details: "Looks faithful",
    timestamps: { inserted_at: Date.now() },
    ...overrides,
  };
}

function buildLLMSpan(overrides?: Partial<LLMSpan>): LLMSpan {
  return {
    span_id: "span-llm-1",
    trace_id: "trace-1",
    type: "llm",
    name: "ChatCompletion",
    model: "gpt-4o",
    vendor: "openai",
    input: {
      type: "chat_messages",
      value: [{ role: "user", content: "Hello" }],
    },
    output: { type: "text", value: "Hi there" },
    timestamps: {
      started_at: 1700000000000,
      first_token_at: 1700000000100,
      finished_at: 1700000001200,
    },
    metrics: {
      prompt_tokens: 500,
      completion_tokens: 150,
      cost: 0.003,
    },
    params: { temperature: 0.7 },
    ...overrides,
  };
}

function buildRAGSpan(overrides?: Partial<RAGSpan>): RAGSpan {
  return {
    span_id: "span-rag-1",
    trace_id: "trace-1",
    type: "rag",
    name: "Retrieval",
    contexts: [
      { document_id: "doc-1", chunk_id: "chunk-1", content: "Some context" },
    ],
    input: { type: "text", value: "search query" },
    output: { type: "text", value: "retrieved results" },
    timestamps: {
      started_at: 1700000000000,
      finished_at: 1700000000500,
    },
    metrics: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Summary JSON tests
// ---------------------------------------------------------------------------

describe("serializeTraceToSummaryJson()", () => {
  describe("when given a trace with metrics and metadata", () => {
    it("produces a valid JSON line with trace-level fields only", () => {
      const trace = buildTrace();
      const line = serializeTraceToSummaryJson({ trace });
      const parsed = JSON.parse(line);

      expect(parsed.trace_id).toBe("trace-1");
      expect(parsed.timestamp).toBe(1700000000000);
      expect(parsed.input).toBe("Hello world");
      expect(parsed.output).toBe("Hi there");
      expect(parsed.labels).toEqual(["production"]);
      expect(parsed.first_token_ms).toBe(100);
      expect(parsed.total_time_ms).toBe(500);
      expect(parsed.prompt_tokens).toBe(10);
      expect(parsed.completion_tokens).toBe(20);
      expect(parsed.total_cost).toBe(0.001);
      expect(parsed.topic).toBe("topic-1");
      expect(parsed.subtopic).toBe("subtopic-1");
    });
  });

  describe("when trace has spans", () => {
    it("does not include spans in the output", () => {
      const trace = buildTrace({
        spans: [buildLLMSpan()],
      });
      const line = serializeTraceToSummaryJson({ trace });
      const parsed = JSON.parse(line);

      expect(parsed.spans).toBeUndefined();
    });
  });

  describe("when trace has evaluations", () => {
    it("includes evaluations as an array", () => {
      const trace = buildTrace({
        evaluations: [
          buildEvaluation({ name: "Faithfulness", score: 0.9 }),
          buildEvaluation({ name: "Relevance", score: 0.8 }),
        ],
      });
      const line = serializeTraceToSummaryJson({ trace });
      const parsed = JSON.parse(line);

      expect(parsed.evaluations).toHaveLength(2);
      expect(parsed.evaluations[0].name).toBe("Faithfulness");
      expect(parsed.evaluations[0].score).toBe(0.9);
    });
  });

  describe("when trace has null metrics", () => {
    it("omits metric fields that are null", () => {
      const trace = buildTrace({ metrics: undefined });
      const line = serializeTraceToSummaryJson({ trace });
      const parsed = JSON.parse(line);

      expect(parsed.first_token_ms).toBeNull();
      expect(parsed.total_time_ms).toBeNull();
    });
  });

  describe("when trace has metadata with custom keys", () => {
    it("includes metadata in the output", () => {
      const trace = buildTrace({
        metadata: {
          labels: ["test"],
          topic_id: null,
          subtopic_id: null,
          user_id: "user-1",
          custom_key: "custom_value",
        },
      });
      const line = serializeTraceToSummaryJson({ trace });
      const parsed = JSON.parse(line);

      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.custom_key).toBe("custom_value");
    });
  });
});

// ---------------------------------------------------------------------------
// Full JSON tests
// ---------------------------------------------------------------------------

describe("serializeTraceToFullJson()", () => {
  describe("when trace has spans and evaluations", () => {
    it("includes spans array and evaluations array", () => {
      const trace = buildTrace({
        spans: [buildLLMSpan(), buildRAGSpan()],
        evaluations: [
          buildEvaluation({ name: "Faithfulness" }),
          buildEvaluation({ name: "Relevance" }),
        ],
      });
      const line = serializeTraceToFullJson({ trace });
      const parsed = JSON.parse(line);

      expect(parsed.trace_id).toBe("trace-1");
      expect(parsed.spans).toHaveLength(2);
      expect(parsed.evaluations).toHaveLength(2);
    });
  });

  describe("when trace has LLM span with model info", () => {
    it("preserves span type-specific fields", () => {
      const trace = buildTrace({
        spans: [buildLLMSpan({ model: "gpt-4o", vendor: "openai" })],
      });
      const line = serializeTraceToFullJson({ trace });
      const parsed = JSON.parse(line);

      expect(parsed.spans[0].model).toBe("gpt-4o");
      expect(parsed.spans[0].vendor).toBe("openai");
      expect(parsed.spans[0].type).toBe("llm");
    });
  });

  describe("when trace has RAG span with contexts", () => {
    it("preserves contexts in span data", () => {
      const trace = buildTrace({
        spans: [buildRAGSpan()],
      });
      const line = serializeTraceToFullJson({ trace });
      const parsed = JSON.parse(line);

      expect(parsed.spans[0].contexts).toHaveLength(1);
      expect(parsed.spans[0].contexts[0].document_id).toBe("doc-1");
    });
  });

  describe("when trace has no spans", () => {
    it("includes an empty spans array", () => {
      const trace = buildTrace({ spans: [] });
      const line = serializeTraceToFullJson({ trace });
      const parsed = JSON.parse(line);

      expect(parsed.spans).toEqual([]);
    });
  });

  describe("when trace has no evaluations", () => {
    it("includes an empty evaluations array", () => {
      const trace = buildTrace({ evaluations: undefined });
      const line = serializeTraceToFullJson({ trace });
      const parsed = JSON.parse(line);

      expect(parsed.evaluations).toEqual([]);
    });
  });
});
