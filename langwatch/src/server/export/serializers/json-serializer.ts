/**
 * JSONL serialization for trace export.
 *
 * Summary mode: one JSON line per trace with trace-level fields (no spans).
 * Full mode: one JSON line per trace with complete spans and evaluations arrays.
 */

import type { Trace, Span, LLMSpan, RAGSpan } from "~/server/tracer/types";
import { RESERVED_METADATA_KEYS } from "./constants";

// ---------------------------------------------------------------------------
// Summary JSONL
// ---------------------------------------------------------------------------

/**
 * Serialize a single trace to a Summary JSONL line.
 *
 * Includes trace-level fields only. Spans are excluded.
 * Each call produces one line; the caller concatenates lines separated by \n.
 *
 * @param trace - The trace to serialize
 * @returns A single JSON string (no trailing newline)
 */
export function serializeTraceToSummaryJson({
  trace,
}: {
  trace: Trace;
}): string {
  const obj = {
    trace_id: trace.trace_id,
    project_id: trace.project_id,
    timestamp: trace.timestamps.started_at,
    input: trace.input?.value ?? null,
    output: trace.output?.value ?? null,
    labels: trace.metadata.labels ?? [],
    first_token_ms: trace.metrics?.first_token_ms ?? null,
    total_time_ms: trace.metrics?.total_time_ms ?? null,
    prompt_tokens: trace.metrics?.prompt_tokens ?? null,
    completion_tokens: trace.metrics?.completion_tokens ?? null,
    total_cost: trace.metrics?.total_cost ?? null,
    metadata: extractMetadataForJson(trace),
    topic: trace.metadata.topic_id ?? null,
    subtopic: trace.metadata.subtopic_id ?? null,
    error: trace.error ? trace.error.message : null,
    evaluations: (trace.evaluations ?? []).map(serializeEvaluation),
  };

  return JSON.stringify(obj);
}

// ---------------------------------------------------------------------------
// Full JSONL
// ---------------------------------------------------------------------------

/**
 * Serialize a single trace to a Full JSONL line.
 *
 * Includes the complete trace object with spans array and evaluations array.
 *
 * @param trace - The trace to serialize (should have populated spans)
 * @returns A single JSON string (no trailing newline)
 */
export function serializeTraceToFullJson({
  trace,
}: {
  trace: Trace;
}): string {
  const obj = {
    trace_id: trace.trace_id,
    project_id: trace.project_id,
    timestamp: trace.timestamps.started_at,
    input: trace.input?.value ?? null,
    output: trace.output?.value ?? null,
    labels: trace.metadata.labels ?? [],
    first_token_ms: trace.metrics?.first_token_ms ?? null,
    total_time_ms: trace.metrics?.total_time_ms ?? null,
    prompt_tokens: trace.metrics?.prompt_tokens ?? null,
    completion_tokens: trace.metrics?.completion_tokens ?? null,
    total_cost: trace.metrics?.total_cost ?? null,
    metadata: extractMetadataForJson(trace),
    topic: trace.metadata.topic_id ?? null,
    subtopic: trace.metadata.subtopic_id ?? null,
    error: trace.error ? trace.error.message : null,
    spans: trace.spans.map(serializeSpanForJson),
    evaluations: (trace.evaluations ?? []).map(serializeEvaluation),
  };

  return JSON.stringify(obj);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pick only the intended public fields from a span for JSON export.
 * Prevents internal/unexpected fields from leaking into exported data.
 */
function serializeSpanForJson(span: Span): Record<string, unknown> {
  const llmSpan = span.type === "llm" ? (span as LLMSpan) : null;
  const ragSpan = span.type === "rag" ? (span as RAGSpan) : null;

  return {
    span_id: span.span_id,
    parent_id: span.parent_id ?? null,
    type: span.type,
    name: span.name ?? null,
    input: span.input ?? null,
    output: span.output ?? null,
    timestamps: span.timestamps,
    metrics: span.metrics ?? null,
    params: span.params ?? null,
    ...(llmSpan ? { model: llmSpan.model ?? null, vendor: llmSpan.vendor ?? null } : {}),
    ...(ragSpan ? { contexts: ragSpan.contexts } : {}),
    error: span.error ?? null,
  };
}

function serializeEvaluation(evaluation: {
  evaluation_id: string;
  evaluator_id: string;
  name: string;
  status: string;
  passed?: boolean | null;
  score?: number | null;
  label?: string | null;
  details?: string | null;
}) {
  return {
    evaluation_id: evaluation.evaluation_id,
    evaluator_id: evaluation.evaluator_id,
    name: evaluation.name,
    status: evaluation.status,
    passed: evaluation.passed ?? null,
    score: evaluation.score ?? null,
    label: evaluation.label ?? null,
    details: evaluation.details ?? null,
  };
}

function extractMetadataForJson(trace: Trace): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(trace.metadata)) {
    if (!RESERVED_METADATA_KEYS.has(key) && value !== null && value !== undefined) {
      metadata[key] = value;
    }
  }
  return metadata;
}
