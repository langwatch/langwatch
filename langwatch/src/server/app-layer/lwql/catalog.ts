/**
 * LWQL catalogue — the allowlist that makes a caller-supplied query safe.
 *
 * Issue #6346 decision 2 (allowlist-total compilation): every entity, field and
 * aggregation is a closed enum mapped to a developer-authored ClickHouse
 * expression. A field name *selects* an expression; it never *becomes* one, so
 * no identifier in the generated SQL originates from user input.
 *
 * Adding a queryable column is therefore a deliberate act — see ADR-081.
 */

/** Value domain of a field, used to reject nonsense comparisons at compile time. */
export type LwqlFieldType = "string" | "number" | "bool" | "timestamp";

export interface LwqlFieldDef {
  /**
   * Expression used when the field is projected or grouped.
   *
   * May legitimately contain `arrayJoin` (see `model`), which is why filtering
   * needs a separate form — `arrayJoin` in a WHERE clause changes row
   * cardinality rather than restricting it.
   */
  selectExpr: string;
  /** Expression used in WHERE. Defaults to `selectExpr` when omitted. */
  filterExpr?: string;
  /**
   * Shape of `filterExpr`. An `"array"` column compares via `has` / `hasAny` /
   * `arrayExists` rather than `=` / `IN`, so that filtering restricts rows
   * instead of unnesting them.
   */
  filterKind?: "scalar" | "array";
  type: LwqlFieldType;
  /**
   * True when the field carries user content that
   * `app-layer/traces/visibility-window.service` teases for out-of-window
   * callers.
   *
   * Issue #6346 decision 7: a filter on a field is a projection of that field
   * one bit at a time, so a gated field is refused as a filter and aggregation
   * target, not merely masked on output. The set is asserted against the
   * redaction service by `__tests__/gating-parity.unit.test.ts` — do not
   * maintain it by hand here.
   */
  contentGated?: boolean;
  /** Shown in error messages and the catalogue endpoint. */
  description: string;
}

export interface LwqlEntityDef {
  /** Physical ClickHouse table. Never reachable from query text. */
  table: string;
  /** Column carrying tenant scope; the compiler always constrains it. */
  tenantColumn: string;
  /** Column used for default time-range bounding. */
  timeColumn: string;
  fields: Record<string, LwqlFieldDef>;
}

/**
 * `Models` is `Array(String)`, so grouping by model requires unnesting.
 *
 * The empty-array guard mirrors the analytics builder: a trace with no models
 * buckets as `unknown` rather than vanishing from the result. ADR-081 records
 * the drift this reconciles — the #5670 spike emitted a bare `arrayJoin(Models)`
 * and silently dropped those rows, giving two different answers to one question.
 */
const MODEL_SELECT = "arrayJoin(if(empty(Models), ['unknown'], Models))";

const TRACE_FIELDS: Record<string, LwqlFieldDef> = {
  trace_id: {
    selectExpr: "TraceId",
    type: "string",
    description: "Trace identifier.",
  },
  project_id: {
    selectExpr: "TenantId",
    type: "string",
    description: "Owning project. Always equals the authenticated scope.",
  },
  started_at: {
    selectExpr: "OccurredAt",
    type: "timestamp",
    description: "When the trace started.",
  },
  model: {
    selectExpr: MODEL_SELECT,
    // `has` restricts rows; `arrayJoin` would multiply them.
    filterExpr: "Models",
    filterKind: "array",
    type: "string",
    description: "Model used by the trace. Traces with none group as 'unknown'.",
  },
  duration_ms: {
    selectExpr: "TotalDurationMs",
    type: "number",
    description: "End-to-end trace duration in milliseconds.",
  },
  cost_usd: {
    selectExpr: "TotalCost",
    type: "number",
    description: "Total trace cost in USD.",
  },
  token_count: {
    selectExpr:
      "(coalesce(TotalPromptTokenCount, 0) + coalesce(TotalCompletionTokenCount, 0))",
    type: "number",
    description: "Prompt plus completion tokens.",
  },
  prompt_tokens: {
    selectExpr: "TotalPromptTokenCount",
    type: "number",
    description: "Prompt tokens.",
  },
  completion_tokens: {
    selectExpr: "TotalCompletionTokenCount",
    type: "number",
    description: "Completion tokens.",
  },
  ttft_ms: {
    selectExpr: "TimeToFirstTokenMs",
    type: "number",
    description: "Time to first token in milliseconds.",
  },
  ttlt_ms: {
    selectExpr: "TimeToLastTokenMs",
    type: "number",
    description: "Time to last token in milliseconds.",
  },
  tokens_per_second: {
    selectExpr: "TokensPerSecond",
    type: "number",
    description: "Throughput in tokens per second.",
  },
  span_count: {
    selectExpr: "SpanCount",
    type: "number",
    description: "Number of spans in the trace.",
  },
  has_error: {
    selectExpr: "ContainsErrorStatus",
    type: "bool",
    description: "Whether any span in the trace reported an error status.",
  },
  blocked_by_guardrail: {
    selectExpr: "BlockedByGuardrail",
    type: "bool",
    description: "Whether a guardrail blocked the trace.",
  },
  topic_id: {
    selectExpr: "TopicId",
    type: "string",
    description: "Assigned topic.",
  },
  subtopic_id: {
    selectExpr: "SubTopicId",
    type: "string",
    description: "Assigned subtopic.",
  },

  // ---- content-gated ----
  // Metadata above stays queryable for out-of-window callers; only the fields
  // below carry user content, and they are refused rather than teased. See
  // decision 7 — teasing a filter target would still leak the full value.
  error: {
    selectExpr: "ErrorMessage",
    type: "string",
    contentGated: true,
    description: "Error message recorded on the trace.",
  },
  input: {
    selectExpr: "ComputedInput",
    type: "string",
    contentGated: true,
    description: "Trace input content.",
  },
  output: {
    selectExpr: "ComputedOutput",
    type: "string",
    contentGated: true,
    description: "Trace output content.",
  },
};

/**
 * `gen_ai.tool.name` is the OTel-aligned key used across the codebase; the bare
 * `tool.name` predates it and still appears on older spans, so read both.
 */
const TOOL_NAME_SELECT =
  "coalesce(nullIf(SpanAttributes['gen_ai.tool.name'], ''), nullIf(SpanAttributes['tool.name'], ''))";

const SPAN_FIELDS: Record<string, LwqlFieldDef> = {
  span_id: {
    selectExpr: "SpanId",
    type: "string",
    description: "Span identifier.",
  },
  trace_id: {
    selectExpr: "TraceId",
    type: "string",
    description: "Owning trace identifier.",
  },
  parent_span_id: {
    selectExpr: "ParentSpanId",
    type: "string",
    description: "Parent span identifier, null for root spans.",
  },
  project_id: {
    selectExpr: "TenantId",
    type: "string",
    description: "Owning project. Always equals the authenticated scope.",
  },
  started_at: {
    selectExpr: "StartTime",
    type: "timestamp",
    description: "When the span started.",
  },
  ended_at: {
    selectExpr: "EndTime",
    type: "timestamp",
    description: "When the span ended.",
  },
  duration_ms: {
    selectExpr: "DurationMs",
    type: "number",
    description: "Span duration in milliseconds.",
  },
  span_name: {
    selectExpr: "SpanName",
    type: "string",
    description: "Span name.",
  },
  service_name: {
    selectExpr: "ServiceName",
    type: "string",
    description: "Emitting service.",
  },
  tool_name: {
    selectExpr: TOOL_NAME_SELECT,
    type: "string",
    description: "Tool invoked by the span, when it is a tool call.",
  },
  model: {
    selectExpr: "nullIf(SpanAttributes['gen_ai.request.model'], '')",
    type: "string",
    description: "Model requested by the span.",
  },
  status_code: {
    selectExpr: "StatusCode",
    type: "number",
    description: "OTel status code.",
  },

  // ---- content-gated ----
  error: {
    selectExpr: "StatusMessage",
    type: "string",
    contentGated: true,
    description: "Status message recorded on the span.",
  },
};

export const ENTITIES: Record<string, LwqlEntityDef> = {
  /**
   * v1 ships `traces` and `spans` only. Issue #6346 decision 8 defers
   * `evaluations` and `sessions` — the shape below is designed to extend, and
   * adding an entity should not require touching the parser or compiler.
   */
  traces: {
    table: "trace_summaries",
    tenantColumn: "TenantId",
    timeColumn: "OccurredAt",
    fields: TRACE_FIELDS,
  },
  spans: {
    table: "stored_spans",
    tenantColumn: "TenantId",
    timeColumn: "StartTime",
    fields: SPAN_FIELDS,
  },
};

export type LwqlEntity = keyof typeof ENTITIES;

export const ENTITY_NAMES = Object.keys(ENTITIES);

/**
 * Aggregate functions, mapped to ClickHouse. Closed by construction: an
 * unrecognised name fails to compile rather than reaching the database.
 */
export const AGGREGATIONS = {
  count: (expr: string) => (expr === "*" ? "count()" : `count(${expr})`),
  sum: (expr: string) => `sum(${expr})`,
  avg: (expr: string) => `avg(${expr})`,
  min: (expr: string) => `min(${expr})`,
  max: (expr: string) => `max(${expr})`,
  p95: (expr: string) => `quantile(0.95)(${expr})`,
} as const;

export type LwqlAggregation = keyof typeof AGGREGATIONS;

export const AGGREGATION_NAMES = Object.keys(AGGREGATIONS) as LwqlAggregation[];

/** `count(*)` is the one aggregate that takes no field. */
export const AGGREGATIONS_ALLOWING_STAR: ReadonlySet<string> = new Set(["count"]);

/** Aggregates that only make sense over a numeric domain. */
export const NUMERIC_ONLY_AGGREGATIONS: ReadonlySet<string> = new Set([
  "sum",
  "avg",
  "p95",
]);

export const getEntity = (name: string): LwqlEntityDef | undefined =>
  Object.prototype.hasOwnProperty.call(ENTITIES, name)
    ? ENTITIES[name]
    : undefined;

export const getField = (
  entity: LwqlEntityDef,
  name: string,
): LwqlFieldDef | undefined =>
  Object.prototype.hasOwnProperty.call(entity.fields, name)
    ? entity.fields[name]
    : undefined;

/** Field names an entity exposes, for error messages and the catalogue endpoint. */
export const fieldNames = (entity: LwqlEntityDef): string[] =>
  Object.keys(entity.fields);

/** Content-gated field names for an entity — see `gating.ts` for the parity check. */
export const gatedFieldNames = (entity: LwqlEntityDef): string[] =>
  Object.entries(entity.fields)
    .filter(([, def]) => def.contentGated)
    .map(([name]) => name);
