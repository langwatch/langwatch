/**
 * Field mappings from Elasticsearch field paths to ClickHouse table and column access.
 *
 * This module maps the ES nested document structure to CH's denormalized table structure.
 * ES uses nested objects (spans.*, evaluations.*, events.*) while CH uses separate tables
 * with JOINs and Map columns for attributes.
 */

/**
 * The ClickHouse table that contains the data for a field
 */
export type CHTable =
  | "trace_summaries"
  | "stored_spans"
  | "evaluation_runs";

/**
 * Field mapping configuration
 */
export interface FieldMapping {
  /** The ClickHouse table containing this field */
  table: CHTable;
  /** The ClickHouse column expression (may include map access) */
  column: string;
  /** Optional description for documentation */
  description?: string;
  /** Whether this field requires array handling */
  isArray?: boolean;
  /** For Map fields, the type of value extraction needed */
  mapValueType?: "string" | "json_array" | "number";
}

/**
 * ES field path to CH field mapping.
 *
 * Maps Elasticsearch field paths used in analytics metrics and filters
 * to their corresponding ClickHouse table and column expressions.
 */
export const fieldMappings: Record<string, FieldMapping> = {
  // ===== Trace Identity Fields =====
  trace_id: {
    table: "trace_summaries",
    column: "TraceId",
    description: "Unique trace identifier",
  },
  project_id: {
    table: "trace_summaries",
    column: "TenantId",
    description: "Project/tenant identifier",
  },

  // ===== Timestamp Fields =====
  "timestamps.started_at": {
    table: "trace_summaries",
    column: "OccurredAt",
    description: "When the trace started (event time)",
  },
  "timestamps.occurred_at": {
    table: "trace_summaries",
    column: "OccurredAt",
    description: "When the trace occurred (event time)",
  },
  "timestamps.inserted_at": {
    table: "trace_summaries",
    column: "CreatedAt",
    description: "When the record was inserted",
  },
  "timestamps.updated_at": {
    table: "trace_summaries",
    column: "LastUpdatedAt",
    description: "When the record was last updated",
  },

  // ===== Metadata Fields (stored in Attributes Map) =====
  "metadata.user_id": {
    table: "trace_summaries",
    column: "Attributes['langwatch.user_id']",
    description: "User identifier",
    mapValueType: "string",
  },
  "metadata.thread_id": {
    table: "trace_summaries",
    column: "Attributes['gen_ai.conversation.id']",
    description: "Thread/conversation identifier",
    mapValueType: "string",
  },
  "metadata.customer_id": {
    table: "trace_summaries",
    column: "Attributes['langwatch.customer_id']",
    description: "Customer identifier",
    mapValueType: "string",
  },
  "metadata.labels": {
    table: "trace_summaries",
    column: "Attributes['langwatch.labels']",
    description: "Labels array (stored as JSON string)",
    mapValueType: "json_array",
  },
  "metadata.topic_id": {
    table: "trace_summaries",
    column: "TopicId",
    description: "Topic identifier",
  },
  "metadata.subtopic_id": {
    table: "trace_summaries",
    column: "SubTopicId",
    description: "Subtopic identifier",
  },
  "metadata.prompt_ids": {
    table: "trace_summaries",
    column: "Attributes['langwatch.prompt_ids']",
    description: "Prompt IDs array (stored as JSON string)",
    mapValueType: "json_array",
  },

  // ===== Performance Metrics =====
  "metrics.total_time_ms": {
    table: "trace_summaries",
    column: "TotalDurationMs",
    description: "Total trace duration in milliseconds",
  },
  "metrics.first_token_ms": {
    table: "trace_summaries",
    column: "TimeToFirstTokenMs",
    description: "Time to first token in milliseconds",
  },
  "metrics.total_cost": {
    table: "trace_summaries",
    column: "TotalCost",
    description: "Total cost of the trace",
  },
  "metrics.prompt_tokens": {
    table: "trace_summaries",
    column: "TotalPromptTokenCount",
    description: "Total prompt token count",
  },
  "metrics.completion_tokens": {
    table: "trace_summaries",
    column: "TotalCompletionTokenCount",
    description: "Total completion token count",
  },
  tokens_per_second: {
    table: "trace_summaries",
    column: "TokensPerSecond",
    description: "Pre-computed tokens per second",
  },

  // ===== Error Fields =====
  "error.has_error": {
    table: "trace_summaries",
    column: "ContainsErrorStatus",
    description: "Whether trace contains any errors",
  },
  "error.message": {
    table: "trace_summaries",
    column: "ErrorMessage",
    description: "Error message if any",
  },

  // ===== Span Fields (requires JOIN with stored_spans) =====
  "spans.span_id": {
    table: "stored_spans",
    column: "SpanId",
    description: "Span identifier",
  },
  "spans.type": {
    table: "stored_spans",
    column: "SpanAttributes['langwatch.span.type']",
    description: "Span type (llm, agent, tool, etc.)",
    mapValueType: "string",
  },
  "spans.model": {
    table: "stored_spans",
    column: "SpanAttributes['gen_ai.request.model']",
    description: "Model name used in the span",
    mapValueType: "string",
  },
  "spans.timestamps.started_at": {
    table: "stored_spans",
    column: "StartTime",
    description: "Span start time",
  },
  "spans.timestamps.finished_at": {
    table: "stored_spans",
    column: "EndTime",
    description: "Span end time",
  },
  "spans.timestamps.first_token_at": {
    table: "stored_spans",
    column: "SpanAttributes['langwatch.first_token_at']",
    description: "First token timestamp for the span",
    mapValueType: "string",
  },
  "spans.metrics.completion_tokens": {
    table: "stored_spans",
    column: "SpanAttributes['gen_ai.usage.output_tokens']",
    description: "Completion/output tokens for the span (canonical OTel name)",
    mapValueType: "number",
  },
  "spans.metrics.prompt_tokens": {
    table: "stored_spans",
    column: "SpanAttributes['gen_ai.usage.input_tokens']",
    description: "Prompt/input tokens for the span (canonical OTel name)",
    mapValueType: "number",
  },
  "spans.contexts.document_id": {
    table: "stored_spans",
    column: "SpanAttributes['langwatch.rag.contexts']",
    description: "RAG document IDs (extracted via JSON from contexts)",
    mapValueType: "json_array",
    isArray: true,
  },
  "spans.contexts.content": {
    table: "stored_spans",
    column: "SpanAttributes['langwatch.rag.contexts']",
    description: "RAG document content (extracted via JSON from contexts)",
    mapValueType: "json_array",
    isArray: true,
  },

  // ===== Evaluation Fields (requires JOIN with evaluation_runs) =====
  "evaluations.evaluator_id": {
    table: "evaluation_runs",
    column: "EvaluatorId",
    description: "Evaluator identifier",
  },
  "evaluations.evaluation_id": {
    table: "evaluation_runs",
    column: "EvaluationId",
    description: "Evaluation instance identifier",
  },
  "evaluations.name": {
    table: "evaluation_runs",
    column: "EvaluatorName",
    description: "Evaluator name",
  },
  "evaluations.type": {
    table: "evaluation_runs",
    column: "EvaluatorType",
    description: "Evaluator type",
  },
  "evaluations.score": {
    table: "evaluation_runs",
    column: "Score",
    description: "Evaluation score",
  },
  "evaluations.passed": {
    table: "evaluation_runs",
    column: "Passed",
    description: "Whether evaluation passed (0/1)",
  },
  "evaluations.label": {
    table: "evaluation_runs",
    column: "Label",
    description: "Evaluation label",
  },
  "evaluations.status": {
    table: "evaluation_runs",
    column: "Status",
    description: "Evaluation processing status",
  },
  "evaluations.is_guardrail": {
    table: "evaluation_runs",
    column: "IsGuardrail",
    description: "Whether this is a guardrail evaluation",
  },

  // ===== Event Fields (stored in stored_spans.Events arrays) =====
  "events.event_type": {
    table: "stored_spans",
    column: "Events.Name",
    description: "Event type/name",
    isArray: true,
  },
  "events.event_id": {
    table: "stored_spans",
    column: "SpanId", // Events don't have separate IDs, use parent span
    description: "Event identifier (uses span ID)",
  },
  "events.timestamps.started_at": {
    table: "stored_spans",
    column: "Events.Timestamp",
    description: "Event timestamp",
    isArray: true,
  },
  "events.metrics.key": {
    table: "stored_spans",
    column: "Events.Attributes",
    description: "Event metrics (stored in attributes map)",
    isArray: true,
  },
  "events.metrics.value": {
    table: "stored_spans",
    column: "Events.Attributes",
    description: "Event metric values",
    isArray: true,
  },
  "events.event_details.key": {
    table: "stored_spans",
    column: "Events.Attributes",
    description: "Event detail keys",
    isArray: true,
  },
  "events.event_details.value": {
    table: "stored_spans",
    column: "Events.Attributes",
    description: "Event detail values",
    isArray: true,
  },

  // ===== Input/Output Sentiment =====
  "input.satisfaction_score": {
    table: "trace_summaries",
    column: "Attributes['langwatch.input.satisfaction_score']",
    description: "Input sentiment satisfaction score",
    mapValueType: "number",
  },

  // ===== Annotation Fields =====
  annotations: {
    table: "trace_summaries",
    column: "HasAnnotation",
    description: "Whether trace has annotations",
  },

  // ===== Model Fields (for grouping) =====
  models: {
    table: "trace_summaries",
    column: "Models",
    description: "Array of models used in trace",
    isArray: true,
  },
};

/**
 * Get the CH field mapping for an ES field path
 */
export function getFieldMapping(esField: string): FieldMapping | undefined {
  return fieldMappings[esField];
}

/**
 * Determine which table is needed for a given ES field
 */
export function getTableForField(esField: string): CHTable {
  const mapping = fieldMappings[esField];
  return mapping?.table ?? "trace_summaries";
}

/**
 * Get the CH column expression for an ES field
 */
export function getColumnExpression(esField: string): string {
  const mapping = fieldMappings[esField];
  if (!mapping) {
    // Fallback: try to construct a reasonable column name
    // Replace dots with underscores and capitalize
    return esField.replace(/\./g, "_");
  }
  return mapping.column;
}

/**
 * Check if a field requires a JOIN to a different table
 */
export function requiresJoin(esField: string): CHTable | null {
  const table = getTableForField(esField);
  return table !== "trace_summaries" ? table : null;
}

/**
 * Get all fields that require a specific table JOIN
 */
export function getFieldsRequiringTable(table: CHTable): string[] {
  return Object.entries(fieldMappings)
    .filter(([_, mapping]) => mapping.table === table)
    .map(([field, _]) => field);
}

/**
 * Table alias conventions for JOINs
 */
export const tableAliases: Record<CHTable, string> = {
  trace_summaries: "ts",
  stored_spans: "ss",
  evaluation_runs: "es",
};

/**
 * Get the alias for a table
 */
export function getTableAlias(table: CHTable): string {
  return tableAliases[table];
}

/**
 * Build JOIN clause for a table
 */
export function buildJoinClause(table: CHTable): string {
  const alias = tableAliases[table];
  const baseAlias = tableAliases.trace_summaries;

  switch (table) {
    case "stored_spans":
      return `JOIN stored_spans ${alias} FINAL ON ${baseAlias}.TenantId = ${alias}.TenantId AND ${baseAlias}.TraceId = ${alias}.TraceId`;
    case "evaluation_runs":
      return `JOIN evaluation_runs ${alias} FINAL ON ${baseAlias}.TenantId = ${alias}.TenantId AND ${baseAlias}.TraceId = ${alias}.TraceId`;
    default:
      return "";
  }
}

/**
 * Build a qualified column reference with table alias
 */
export function qualifiedColumn(esField: string): string {
  const mapping = fieldMappings[esField];
  if (!mapping) {
    return esField;
  }

  const alias = tableAliases[mapping.table];
  const column = mapping.column;

  // If column already starts with a function or is complex, don't prefix
  if (column.includes("(") || column.includes("[")) {
    // For map access, we need to prefix the table alias
    if (column.includes("[")) {
      const parts = column.split("[");
      return `${alias}.${parts[0]}[${parts.slice(1).join("[")}`;
    }
    return column;
  }

  return `${alias}.${column}`;
}
