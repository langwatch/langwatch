/**
 * CSV serialization for trace export.
 *
 * Summary mode: one row per trace with trace-level fields and evaluation columns.
 * Full mode: one row per span with trace fields denormalized (repeated per row).
 *
 * Uses PapaParse for RFC 4180-compliant CSV generation.
 */

import Parse from "papaparse";
import type {
  Trace,
  Span,
  LLMSpan,
  RAGSpan,
  Evaluation,
  SpanInputOutput,
  ErrorCapture,
} from "~/server/tracer/types";
import { RESERVED_METADATA_KEYS } from "./constants";

// ---------------------------------------------------------------------------
// Summary CSV
// ---------------------------------------------------------------------------

const SUMMARY_COLUMNS = [
  "trace_id",
  "timestamp",
  "input",
  "output",
  "labels",
  "first_token_ms",
  "total_time_ms",
  "prompt_tokens",
  "completion_tokens",
  "total_cost",
  "metadata",
  "topic",
  "subtopic",
] as const;

/**
 * Serialize traces to Summary CSV (one row per trace).
 *
 * @param traces - Array of Trace objects
 * @param evaluatorNames - Ordered list of evaluator display names for column generation
 * @returns CSV string with header row and one data row per trace
 */
export function serializeTracesToSummaryCsv({
  traces,
  evaluatorNames,
}: {
  traces: Trace[];
  evaluatorNames: string[];
}): string {
  const headers = buildSummaryHeaders({ evaluatorNames });
  const rows = traces.map((trace) =>
    buildSummaryRow({ trace, evaluatorNames }),
  );

  return Parse.unparse({ fields: headers, data: rows });
}

function buildSummaryHeaders({
  evaluatorNames,
}: {
  evaluatorNames: string[];
}): string[] {
  const headers: string[] = [...SUMMARY_COLUMNS];
  for (const name of evaluatorNames) {
    headers.push(`${name}_score`);
    headers.push(`${name}_passed`);
    headers.push(`${name}_label`);
    headers.push(`${name}_details`);
  }
  return headers;
}

function buildSummaryRow({
  trace,
  evaluatorNames,
}: {
  trace: Trace;
  evaluatorNames: string[];
}): string[] {
  const customMetadata = extractCustomMetadata(trace);

  const row: string[] = [
    trace.trace_id,
    String(trace.timestamps.started_at),
    trace.input?.value ?? "",
    trace.output?.value ?? "",
    (trace.metadata.labels ?? []).join(", "),
    nullableNumber(trace.metrics?.first_token_ms),
    nullableNumber(trace.metrics?.total_time_ms),
    nullableNumber(trace.metrics?.prompt_tokens),
    nullableNumber(trace.metrics?.completion_tokens),
    nullableNumber(trace.metrics?.total_cost),
    Object.keys(customMetadata).length > 0
      ? JSON.stringify(customMetadata)
      : "",
    trace.metadata.topic_id ?? "",
    trace.metadata.subtopic_id ?? "",
  ];

  row.push(...buildEvaluationColumns({ evaluations: trace.evaluations, evaluatorNames }));

  return row;
}

// ---------------------------------------------------------------------------
// Full CSV
// ---------------------------------------------------------------------------

const FULL_TRACE_COLUMNS = [
  "trace_id",
  "trace_timestamp",
  "trace_input",
  "trace_output",
  "trace_total_time_ms",
  "trace_first_token_ms",
  "trace_total_cost",
  "trace_prompt_tokens",
  "trace_completion_tokens",
  "trace_labels",
  "trace_metadata",
  "trace_topic",
  "trace_subtopic",
  "trace_error",
] as const;

const FULL_SPAN_COLUMNS = [
  "span_id",
  "parent_span_id",
  "span_type",
  "span_name",
  "span_model",
  "span_vendor",
  "span_input",
  "span_output",
  "span_started_at",
  "span_finished_at",
  "span_duration_ms",
  "span_first_token_ms",
  "span_prompt_tokens",
  "span_completion_tokens",
  "span_cost",
  "span_error",
  "span_params",
  "span_contexts",
] as const;

/**
 * Serialize traces to Full CSV (one row per span, trace fields denormalized).
 *
 * @param traces - Array of Trace objects with populated spans
 * @param evaluatorNames - Ordered list of evaluator display names for column generation
 * @returns CSV string with header row and one data row per span
 */
export function serializeTracesToFullCsv({
  traces,
  evaluatorNames,
}: {
  traces: Trace[];
  evaluatorNames: string[];
}): string {
  const headers = buildFullHeaders({ evaluatorNames });
  const rows: string[][] = [];

  for (const trace of traces) {
    for (const span of trace.spans) {
      rows.push(buildFullRow({ trace, span, evaluatorNames }));
    }
  }

  return Parse.unparse({ fields: headers, data: rows });
}

function buildFullHeaders({
  evaluatorNames,
}: {
  evaluatorNames: string[];
}): string[] {
  const headers: string[] = [
    ...FULL_TRACE_COLUMNS,
    ...FULL_SPAN_COLUMNS,
  ];
  for (const name of evaluatorNames) {
    headers.push(`${name}_score`);
    headers.push(`${name}_passed`);
    headers.push(`${name}_label`);
    headers.push(`${name}_details`);
  }
  return headers;
}

function buildFullRow({
  trace,
  span,
  evaluatorNames,
}: {
  trace: Trace;
  span: Span;
  evaluatorNames: string[];
}): string[] {
  const customMetadata = extractCustomMetadata(trace);
  const duration = span.timestamps.finished_at - span.timestamps.started_at;
  const firstTokenMs = span.timestamps.first_token_at
    ? span.timestamps.first_token_at - span.timestamps.started_at
    : null;

  const llmSpan = span.type === "llm" ? (span as LLMSpan) : null;
  const ragSpan = span.type === "rag" ? (span as RAGSpan) : null;

  const row: string[] = [
    // Trace columns
    trace.trace_id,
    String(trace.timestamps.started_at),
    trace.input?.value ?? "",
    trace.output?.value ?? "",
    nullableNumber(trace.metrics?.total_time_ms),
    nullableNumber(trace.metrics?.first_token_ms),
    nullableNumber(trace.metrics?.total_cost),
    nullableNumber(trace.metrics?.prompt_tokens),
    nullableNumber(trace.metrics?.completion_tokens),
    (trace.metadata.labels ?? []).join(", "),
    Object.keys(customMetadata).length > 0
      ? JSON.stringify(customMetadata)
      : "",
    trace.metadata.topic_id ?? "",
    trace.metadata.subtopic_id ?? "",
    serializeError(trace.error),
    // Span columns
    span.span_id,
    span.parent_id ?? "",
    span.type,
    span.name ?? "",
    llmSpan?.model ?? "",
    llmSpan?.vendor ?? "",
    serializeSpanIO(span.input),
    serializeSpanIO(span.output),
    String(span.timestamps.started_at),
    String(span.timestamps.finished_at),
    String(duration),
    nullableNumber(firstTokenMs),
    nullableNumber(span.metrics?.prompt_tokens),
    nullableNumber(span.metrics?.completion_tokens),
    nullableNumber(span.metrics?.cost),
    serializeError(span.error),
    span.params ? JSON.stringify(span.params) : "",
    ragSpan?.contexts ? JSON.stringify(ragSpan.contexts) : "",
  ];

  row.push(...buildEvaluationColumns({ evaluations: trace.evaluations, evaluatorNames }));

  return row;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Build evaluation columns for each evaluator name.
 * Returns a new array of column values; the caller concatenates it with the row.
 */
function buildEvaluationColumns({
  evaluations,
  evaluatorNames,
}: {
  evaluations: Evaluation[] | undefined;
  evaluatorNames: string[];
}): string[] {
  const columns: string[] = [];
  for (const name of evaluatorNames) {
    const evaluation = evaluations?.find((e) => e.name === name);
    if (evaluation) {
      columns.push(nullableNumber(evaluation.score));
      columns.push(evaluation.passed != null ? String(evaluation.passed) : "");
      columns.push(evaluation.label ?? "");
      columns.push(evaluation.details ?? "");
    } else {
      columns.push("", "", "", "");
    }
  }
  return columns;
}

function nullableNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Serialize a span input or output to a string for CSV export.
 * Structured types (chat_messages, json, list) are stringified as JSON.
 */
function serializeSpanIO(
  io: SpanInputOutput | null | undefined,
): string {
  if (!io) return "";
  if (io.type === "chat_messages") {
    return JSON.stringify(io.value);
  }
  if (io.type === "json") {
    return JSON.stringify(io.value);
  }
  if (io.type === "list") {
    return JSON.stringify(io.value);
  }
  return String(io.value ?? "");
}

function serializeError(error: ErrorCapture | null | undefined): string {
  if (!error) return "";
  return error.message;
}

/**
 * Extract custom (non-reserved) metadata keys from a trace.
 */
function extractCustomMetadata(trace: Trace): Record<string, unknown> {
  const custom: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(trace.metadata)) {
    if (!RESERVED_METADATA_KEYS.has(key) && value !== null && value !== undefined) {
      custom[key] = value;
    }
  }
  return custom;
}
