/**
 * @vitest-environment node
 *
 * Unit tests for CSV serializers (summary and full mode).
 * Pure function tests — no mocking needed.
 */

import { describe, expect, it } from "vitest";
import Parse from "papaparse";
import type { Trace, Evaluation, Span, LLMSpan, RAGSpan } from "~/server/tracer/types";
import {
  serializeTracesToSummaryCsv,
  serializeTracesToFullCsv,
} from "../serializers/csv-serializer";

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
      value: [
        { role: "user", content: "Hello" },
      ],
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
      { document_id: "doc-2", chunk_id: "chunk-2", content: "More context" },
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

function buildBaseSpan(overrides?: Partial<Span>): Span {
  return {
    span_id: "span-chain-1",
    trace_id: "trace-1",
    type: "chain",
    name: "MainChain",
    input: { type: "text", value: "chain input" },
    output: { type: "text", value: "chain output" },
    timestamps: {
      started_at: 1700000000000,
      finished_at: 1700000002000,
    },
    metrics: {},
    ...overrides,
  };
}

function parseCsv(csvString: string) {
  return Parse.parse(csvString.trim(), { header: true, skipEmptyLines: true });
}

// ---------------------------------------------------------------------------
// Summary CSV tests
// ---------------------------------------------------------------------------

describe("serializeTracesToSummaryCsv()", () => {
  describe("when given a single trace with no evaluations", () => {
    it("creates one row with correct trace-level columns", () => {
      const trace = buildTrace();
      const csv = serializeTracesToSummaryCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      expect(result.errors).toHaveLength(0);
      expect(result.data).toHaveLength(1);

      const row = result.data[0] as Record<string, string>;
      expect(row["trace_id"]).toBe("trace-1");
      expect(row["timestamp"]).toBe("1700000000000");
      expect(row["input"]).toBe("Hello world");
      expect(row["output"]).toBe("Hi there");
      expect(row["labels"]).toBe("production");
      expect(row["first_token_ms"]).toBe("100");
      expect(row["total_time_ms"]).toBe("500");
      expect(row["prompt_tokens"]).toBe("10");
      expect(row["completion_tokens"]).toBe("20");
      expect(row["total_cost"]).toBe("0.001");
      expect(row["topic"]).toBe("topic-1");
      expect(row["subtopic"]).toBe("subtopic-1");
    });
  });

  describe("when given traces with evaluations", () => {
    it("includes per-evaluator score, passed, label, and details columns", () => {
      const trace = buildTrace({
        evaluations: [
          buildEvaluation({ name: "Faithfulness", score: 0.95, passed: true, details: "All good" }),
          buildEvaluation({ name: "Relevance", score: 0.8, passed: false, label: "low", details: "Needs work" }),
        ],
      });

      const csv = serializeTracesToSummaryCsv({
        traces: [trace],
        evaluatorNames: ["Faithfulness", "Relevance"],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      expect(row["Faithfulness_score"]).toBe("0.95");
      expect(row["Faithfulness_passed"]).toBe("true");
      expect(row["Faithfulness_details"]).toBe("All good");
      expect(row["Relevance_score"]).toBe("0.8");
      expect(row["Relevance_passed"]).toBe("false");
      expect(row["Relevance_label"]).toBe("low");
      expect(row["Relevance_details"]).toBe("Needs work");
    });
  });

  describe("when trace has no evaluations but evaluator names are provided", () => {
    it("leaves evaluation columns empty", () => {
      const trace = buildTrace({ evaluations: [] });
      const csv = serializeTracesToSummaryCsv({
        traces: [trace],
        evaluatorNames: ["Toxicity"],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      expect(row["Toxicity_score"]).toBe("");
      expect(row["Toxicity_passed"]).toBe("");
      expect(row["Toxicity_label"]).toBe("");
      expect(row["Toxicity_details"]).toBe("");
    });
  });

  describe("when trace input contains commas, quotes, and newlines", () => {
    it("escapes special characters properly", () => {
      const trace = buildTrace({
        input: { value: 'He said "hello, world"\nand left' },
      });
      const csv = serializeTracesToSummaryCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      expect(row["input"]).toBe('He said "hello, world"\nand left');
    });
  });

  describe("when trace has null metrics", () => {
    it("leaves metric columns empty", () => {
      const trace = buildTrace({
        metrics: undefined,
      });
      const csv = serializeTracesToSummaryCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      expect(row["first_token_ms"]).toBe("");
      expect(row["total_time_ms"]).toBe("");
      expect(row["prompt_tokens"]).toBe("");
      expect(row["completion_tokens"]).toBe("");
      expect(row["total_cost"]).toBe("");
    });
  });

  describe("when multiple traces are provided", () => {
    it("creates one row per trace", () => {
      const traces = [
        buildTrace({ trace_id: "trace-1" }),
        buildTrace({ trace_id: "trace-2" }),
        buildTrace({ trace_id: "trace-3" }),
      ];
      const csv = serializeTracesToSummaryCsv({
        traces,
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      expect(result.data).toHaveLength(3);
    });
  });

  describe("when metadata contains custom keys", () => {
    it("serializes metadata as JSON string", () => {
      const trace = buildTrace({
        metadata: {
          labels: ["prod"],
          topic_id: null,
          subtopic_id: null,
          custom_field: "custom_value",
        },
      });
      const csv = serializeTracesToSummaryCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      // metadata should be serialized as JSON containing the custom keys
      expect(row["metadata"]).toContain("custom_field");
      expect(row["metadata"]).toContain("custom_value");
    });
  });
});

// ---------------------------------------------------------------------------
// Full CSV tests
// ---------------------------------------------------------------------------

describe("serializeTracesToFullCsv()", () => {
  describe("when trace has LLM and RAG spans", () => {
    it("creates one row per span with trace fields repeated", () => {
      const trace = buildTrace({
        spans: [
          buildBaseSpan(),
          buildLLMSpan(),
          buildRAGSpan(),
        ],
      });

      const csv = serializeTracesToFullCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      expect(result.errors).toHaveLength(0);
      expect(result.data).toHaveLength(3);

      // Each row should have trace-level fields repeated
      for (const row of result.data as Record<string, string>[]) {
        expect(row["trace_id"]).toBe("trace-1");
        expect(row["trace_timestamp"]).toBe("1700000000000");
        expect(row["trace_input"]).toBe("Hello world");
        expect(row["trace_output"]).toBe("Hi there");
      }
    });
  });

  describe("when trace has an LLM span", () => {
    it("includes model, vendor, and LLM-specific fields", () => {
      const llmSpan = buildLLMSpan({
        model: "gpt-4o",
        vendor: "openai",
      });
      const trace = buildTrace({ spans: [llmSpan] });

      const csv = serializeTracesToFullCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      expect(row["span_model"]).toBe("gpt-4o");
      expect(row["span_vendor"]).toBe("openai");
      expect(row["span_type"]).toBe("llm");
      expect(row["span_name"]).toBe("ChatCompletion");
    });
  });

  describe("when LLM span has chat_messages input", () => {
    it("stringifies the input as JSON", () => {
      const llmSpan = buildLLMSpan({
        input: {
          type: "chat_messages",
          value: [{ role: "user", content: "Hello" }],
        },
      });
      const trace = buildTrace({ spans: [llmSpan] });

      const csv = serializeTracesToFullCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      const parsed = JSON.parse(row["span_input"]!);
      expect(parsed).toEqual([{ role: "user", content: "Hello" }]);
    });
  });

  describe("when trace has a RAG span", () => {
    it("includes span_contexts as JSON", () => {
      const ragSpan = buildRAGSpan();
      const trace = buildTrace({ spans: [ragSpan] });

      const csv = serializeTracesToFullCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      const contexts = JSON.parse(row["span_contexts"]!);
      expect(contexts).toHaveLength(2);
      expect(contexts[0]).toEqual({
        document_id: "doc-1",
        chunk_id: "chunk-1",
        content: "Some context",
      });
    });
  });

  describe("when span has timing and token metrics", () => {
    it("includes duration, tokens, and cost fields", () => {
      const llmSpan = buildLLMSpan({
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
      });
      const trace = buildTrace({ spans: [llmSpan] });

      const csv = serializeTracesToFullCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      expect(row["span_duration_ms"]).toBe("1200");
      expect(row["span_first_token_ms"]).toBe("100");
      expect(row["span_prompt_tokens"]).toBe("500");
      expect(row["span_completion_tokens"]).toBe("150");
      expect(row["span_cost"]).toBe("0.003");
    });
  });

  describe("when span has null input and null output", () => {
    it("leaves span_input and span_output empty", () => {
      const span = buildBaseSpan({
        input: null,
        output: null,
      });
      const trace = buildTrace({ spans: [span] });

      const csv = serializeTracesToFullCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      expect(row["span_input"]).toBe("");
      expect(row["span_output"]).toBe("");
    });
  });

  describe("when trace has evaluations in full mode", () => {
    it("includes evaluation columns for each row", () => {
      const trace = buildTrace({
        spans: [buildLLMSpan()],
        evaluations: [
          buildEvaluation({ name: "Toxicity", score: 0.95, passed: true, details: "No toxic content detected" }),
        ],
      });

      const csv = serializeTracesToFullCsv({
        traces: [trace],
        evaluatorNames: ["Toxicity"],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      expect(row["Toxicity_score"]).toBe("0.95");
      expect(row["Toxicity_passed"]).toBe("true");
      expect(row["Toxicity_details"]).toBe("No toxic content detected");
    });
  });

  describe("when span has params", () => {
    it("includes span_params as JSON string", () => {
      const llmSpan = buildLLMSpan({
        params: { temperature: 0.7, max_tokens: 100 },
      });
      const trace = buildTrace({ spans: [llmSpan] });

      const csv = serializeTracesToFullCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      const params = JSON.parse(row["span_params"]!);
      expect(params).toEqual({ temperature: 0.7, max_tokens: 100 });
    });
  });

  describe("when span has an error", () => {
    it("includes span_error with the error message", () => {
      const span = buildBaseSpan({
        error: { has_error: true, message: "Something broke", stacktrace: ["line1"] },
      });
      const trace = buildTrace({ spans: [span] });

      const csv = serializeTracesToFullCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      expect(row["span_error"]).toContain("Something broke");
    });
  });

  describe("when trace has a parent span relationship", () => {
    it("includes parent_span_id", () => {
      const childSpan = buildLLMSpan({
        span_id: "child-span",
        parent_id: "parent-span",
      });
      const trace = buildTrace({ spans: [childSpan] });

      const csv = serializeTracesToFullCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      expect(row["span_id"]).toBe("child-span");
      expect(row["parent_span_id"]).toBe("parent-span");
    });
  });

  describe("when trace has error at trace level", () => {
    it("includes trace_error in every span row", () => {
      const trace = buildTrace({
        error: { has_error: true, message: "Trace error", stacktrace: [] },
        spans: [buildBaseSpan()],
      });

      const csv = serializeTracesToFullCsv({
        traces: [trace],
        evaluatorNames: [],
      });

      const result = parseCsv(csv);
      const row = result.data[0] as Record<string, string>;
      expect(row["trace_error"]).toContain("Trace error");
    });
  });
});
