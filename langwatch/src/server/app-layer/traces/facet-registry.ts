import {
  deriveTraceOrigin,
  TRACE_ORIGIN_CLICKHOUSE_EXPRESSION,
} from "./derive-trace-origin";
import {
  deriveTraceStatus,
  TRACE_STATUS_CLICKHOUSE_EXPRESSION,
} from "./derive-trace-status";
import {
  EVALUATOR_FACET,
  EVENT_ATTRIBUTE_KEYS_FACET,
  EVENT_FACET,
  LABEL_FACET,
  METADATA_KEYS_FACET,
  SPAN_ATTRIBUTE_KEYS_FACET,
  SPAN_NAME_FACET,
  SPAN_STATUS_FACET,
  TRACE_METADATA_FACET,
} from "./facets";
import type { CategoricalRead, RangeRead } from "./filter-to-clickhouse/field-def";
import { UNSUPPORTED } from "./filter-to-clickhouse/field-def";

export type FacetTable = "trace_summaries" | "evaluation_runs" | "stored_spans";
export type FacetGroup =
  | "trace"
  | "evaluation"
  | "span"
  | "metadata"
  | "prompt";

export interface FacetQueryContext {
  tenantId: string;
  timeRange: { from: number; to: number };
  limit: number;
  offset: number;
  prefix?: string;
}

export interface FacetQuery {
  sql: string;
  params: Record<string, unknown>;
  /**
   * Optional per-query ClickHouse settings (e.g. a memory ceiling / external
   * GROUP BY threshold for the unbounded key-discovery facets). Passed straight
   * through as `clickhouse_settings` when the query runs.
   */
  settings?: Record<string, string>;
}

interface BaseFacetDef {
  key: string;
  label: string;
  group: FacetGroup;
  table: FacetTable;
}

export interface ExpressionCategoricalDef extends BaseFacetDef {
  kind: "categorical";
  expression: string;
  /**
   * In-memory accessor mirroring `expression`, letting the filter compiler
   * evaluate this field against fold state without a ClickHouse round-trip.
   * Present on the auto-derived `trace_summaries` facets (cheap reads over
   * `TraceSummaryData`); cross-table facets attach their per-collection read in
   * `filter-to-clickhouse/build-handlers.ts` instead.
   */
  read?: CategoricalRead;
}

export interface QueryBuilderCategoricalDef extends BaseFacetDef {
  kind: "categorical";
  queryBuilder: (ctx: FacetQueryContext) => FacetQuery;
}

export interface RangeFacetDef extends BaseFacetDef {
  kind: "range";
  expression: string;
  /**
   * When true, this integer facet can ALSO be presented as a "Discrete"
   * tick-list (distinct values + counts), not just a min/max slider. Discover
   * computes the distinct values for these facets; the sidebar falls back to
   * the slider when the distinct count exceeds the discrete threshold. Only
   * set on small, naturally-bounded integer columns (e.g. prompt version,
   * span count) — each flag adds one GROUP BY query to discovery.
   */
  isDiscrete?: boolean;
  /** In-memory accessor mirroring `expression`. See {@link ExpressionCategoricalDef.read}. */
  read?: RangeRead;
}

export interface DynamicKeysDef extends BaseFacetDef {
  kind: "dynamic_keys";
  queryBuilder: (ctx: FacetQueryContext) => FacetQuery;
}

export type CategoricalFacetDef =
  | ExpressionCategoricalDef
  | QueryBuilderCategoricalDef;

export type FacetDefinition =
  | CategoricalFacetDef
  | RangeFacetDef
  | DynamicKeysDef;

export const TABLE_TIME_COLUMNS: Record<FacetTable, string> = {
  trace_summaries: "OccurredAt",
  evaluation_runs: "ScheduledAt",
  stored_spans: "StartTime",
};

export const FACET_REGISTRY: readonly FacetDefinition[] = [
  // trace_summaries: simple expression facets
  {
    key: "status",
    kind: "categorical",
    label: "Status",
    group: "trace",
    table: "trace_summaries",
    expression: TRACE_STATUS_CLICKHOUSE_EXPRESSION,
    read: (t) => deriveTraceStatus(t.summary),
  },
  {
    key: "origin",
    kind: "categorical",
    label: "Origin",
    group: "trace",
    table: "trace_summaries",
    expression: TRACE_ORIGIN_CLICKHOUSE_EXPRESSION,
    read: (t) => deriveTraceOrigin(t.summary.attributes),
  },
  {
    key: "service",
    kind: "categorical",
    label: "Service",
    group: "trace",
    table: "trace_summaries",
    expression: "Attributes['service.name']",
    read: (t) => t.summary.attributes["service.name"] ?? "",
  },
  {
    key: "model",
    kind: "categorical",
    label: "Model",
    group: "trace",
    table: "trace_summaries",
    expression: "arrayJoin(Models)",
  },
  {
    key: "user",
    kind: "categorical",
    label: "User",
    group: "trace",
    table: "trace_summaries",
    expression: "Attributes['langwatch.user_id']",
    read: (t) => t.summary.attributes["langwatch.user_id"] ?? "",
  },
  {
    key: "conversation",
    kind: "categorical",
    label: "Conversation",
    group: "trace",
    table: "trace_summaries",
    expression: "Attributes['gen_ai.conversation.id']",
    read: (t) => t.summary.attributes["gen_ai.conversation.id"] ?? "",
  },
  {
    // The same key the analytics layer aliases as `metadata.customer_id`.
    // SDKs hoist it onto `trace_summaries.Attributes` at ingest, so this is
    // a cheap expression facet — no subquery, no join.
    key: "customer",
    kind: "categorical",
    label: "Customer",
    group: "trace",
    table: "trace_summaries",
    expression: "Attributes['langwatch.customer_id']",
    read: (t) => t.summary.attributes["langwatch.customer_id"] ?? "",
  },
  {
    // Simulator-produced traces stamp the run id onto `Attributes` at
    // ingest (see `meta-handlers.ts`'s scenarioRun translator). Surfacing
    // it as a facet lets users scope the list to "all traces from this
    // scenario run" without hand-typing the prefix.
    key: "scenarioRun",
    kind: "categorical",
    label: "Scenario run",
    group: "trace",
    table: "trace_summaries",
    expression: "Attributes['scenario.run_id']",
  },
  {
    key: "topic",
    kind: "categorical",
    label: "Topic",
    group: "trace",
    table: "trace_summaries",
    expression: "TopicId",
    read: (t) => t.summary.topicId,
  },
  {
    key: "subtopic",
    kind: "categorical",
    label: "Subtopic",
    group: "trace",
    table: "trace_summaries",
    expression: "SubTopicId",
    read: (t) => t.summary.subTopicId,
  },
  {
    key: "traceName",
    kind: "categorical",
    label: "Trace name",
    group: "trace",
    table: "trace_summaries",
    expression: "TraceName",
    read: (t) => t.summary.traceName,
  },
  {
    key: "rootSpanType",
    kind: "categorical",
    label: "Root span type",
    group: "trace",
    table: "trace_summaries",
    expression: "RootSpanType",
    read: (t) => t.summary.rootSpanType,
  },
  {
    key: "guardrail",
    kind: "categorical",
    label: "Guardrail",
    group: "trace",
    table: "trace_summaries",
    expression: "if(BlockedByGuardrail, 'blocked', 'allowed')",
    read: (t) => (t.summary.blockedByGuardrail ? "blocked" : "allowed"),
  },
  {
    key: "annotation",
    kind: "categorical",
    label: "Annotation",
    group: "trace",
    table: "trace_summaries",
    // `HasAnnotation` is `Nullable(Bool)` and is written as NULL for traces
    // that were never annotated, so a bare `if(HasAnnotation, ...)` returns
    // NULL — not `'unannotated'` — and those traces drop out of both the facet
    // counts and the `annotation:unannotated` filter, while the `read` below
    // calls them unannotated. Coalesce, matching the analytics filter's
    // `HasAnnotation = false OR HasAnnotation IS NULL`.
    expression: "if(ifNull(HasAnnotation, false), 'annotated', 'unannotated')",
    read: (t) =>
      t.summary.annotationIds.length > 0 ? "annotated" : "unannotated",
  },
  {
    key: "containsAi",
    kind: "categorical",
    label: "Contains AI",
    group: "trace",
    table: "trace_summaries",
    expression: "if(ContainsAi, 'yes', 'no')",
    read: (t) => (t.summary.containsAi ? "yes" : "no"),
  },
  {
    key: "errorMessage",
    kind: "categorical",
    label: "Error message",
    group: "trace",
    table: "trace_summaries",
    expression: "ErrorMessage",
    read: (t) => t.summary.errorMessage,
  },
  {
    key: "tokensEstimated",
    kind: "categorical",
    label: "Tokens estimated",
    group: "trace",
    table: "trace_summaries",
    expression: "if(TokensEstimated, 'estimated', 'actual')",
    read: (t) => (t.summary.tokensEstimated ? "estimated" : "actual"),
  },

  // trace_summaries: prompt facets (rolled up at ingest from span attributes)
  {
    key: "selectedPrompt",
    kind: "categorical",
    label: "Selected prompt",
    group: "prompt",
    table: "trace_summaries",
    expression: "SelectedPromptId",
    read: (t) => t.summary.selectedPromptId,
  },
  {
    key: "lastUsedPrompt",
    kind: "categorical",
    label: "Last used prompt",
    group: "prompt",
    table: "trace_summaries",
    expression: "LastUsedPromptId",
    read: (t) => t.summary.lastUsedPromptId,
  },
  {
    key: "promptVersion",
    kind: "range",
    label: "Prompt version",
    group: "prompt",
    table: "trace_summaries",
    expression: "LastUsedPromptVersionNumber",
    isDiscrete: true,
    read: (t) => t.summary.lastUsedPromptVersionNumber,
  },

  // trace_summaries: queryBuilder facets
  LABEL_FACET,

  // trace_summaries: range facets
  {
    key: "cost",
    kind: "range",
    label: "Cost",
    group: "trace",
    table: "trace_summaries",
    expression: "TotalCost",
    read: (t) => t.summary.totalCost,
  },
  {
    key: "duration",
    kind: "range",
    // Cells humanise the value (`7.0s`), so the unit doesn't need to live
    // in the label.
    label: "Duration",
    group: "trace",
    table: "trace_summaries",
    expression: "TotalDurationMs",
    read: (t) => t.summary.totalDurationMs,
  },
  {
    key: "tokens",
    kind: "range",
    label: "Total tokens",
    group: "trace",
    table: "trace_summaries",
    expression: "TotalPromptTokenCount + TotalCompletionTokenCount",
    // Mirror the SQL sum's NULL propagation: a null operand makes the whole
    // sum null (excluded), rather than silently defaulting to zero.
    read: (t) => {
      const prompt = t.summary.totalPromptTokenCount;
      const completion = t.summary.totalCompletionTokenCount;
      return prompt == null || completion == null ? null : prompt + completion;
    },
  },
  {
    key: "ttft",
    kind: "range",
    label: "Time to first token",
    group: "trace",
    table: "trace_summaries",
    expression: "TimeToFirstTokenMs",
    read: (t) => t.summary.timeToFirstTokenMs,
  },
  {
    key: "ttlt",
    kind: "range",
    label: "Time to last token",
    group: "trace",
    table: "trace_summaries",
    expression: "TimeToLastTokenMs",
    read: (t) => t.summary.timeToLastTokenMs,
  },
  {
    key: "promptTokens",
    kind: "range",
    label: "Prompt tokens",
    group: "trace",
    table: "trace_summaries",
    expression: "TotalPromptTokenCount",
    read: (t) => t.summary.totalPromptTokenCount,
  },
  {
    key: "completionTokens",
    kind: "range",
    label: "Completion tokens",
    group: "trace",
    table: "trace_summaries",
    expression: "TotalCompletionTokenCount",
    read: (t) => t.summary.totalCompletionTokenCount,
  },
  {
    key: "tokensPerSecond",
    kind: "range",
    label: "Tokens / second",
    group: "trace",
    table: "trace_summaries",
    expression: "TokensPerSecond",
    read: (t) => t.summary.tokensPerSecond,
  },
  {
    key: "spans",
    kind: "range",
    label: "Span count",
    group: "trace",
    table: "trace_summaries",
    expression: "SpanCount",
    isDiscrete: true,
    read: (t) => t.summary.spanCount,
  },
  {
    // Stored payload size of the trace in bytes — the materialised
    // `_size_bytes` column (CH-native `byteSize(...)` over the heavy
    // payload columns; see migration 00032). SELECT-only: it's a
    // MATERIALIZED column so it never appears in INSERTs. High-cardinality,
    // so it stays a min/max slider (no `isDiscrete`). Cells humanise the
    // value (`1.4 MB`), so no unit lives in the label.
    key: "size",
    kind: "range",
    label: "Storage size",
    group: "trace",
    table: "trace_summaries",
    expression: "_size_bytes",
    // `_size_bytes` is a MATERIALIZED read-only column; `sizeBytes` is undefined
    // on the fold state at dispatch, so it can't be evaluated in memory.
    read: () => UNSUPPORTED,
  },

  // metadata: dynamic keys
  METADATA_KEYS_FACET,
  // trace_summaries: metadata-scoped dynamic keys (the `metadata.*` subset of
  // METADATA_KEYS_FACET, surfaced as a first-class trace facet)
  TRACE_METADATA_FACET,

  // evaluation_runs: cross-table
  EVALUATOR_FACET,
  {
    key: "evaluatorStatus",
    kind: "categorical",
    label: "Evaluator status",
    group: "evaluation",
    table: "evaluation_runs",
    expression: "Status",
  },
  {
    key: "evaluatorVerdict",
    kind: "categorical",
    label: "Evaluator verdict",
    group: "evaluation",
    table: "evaluation_runs",
    // Surface a 4-way label so users can pick pass / fail / error / unknown
    // without dealing with the 0/1/null underlying UInt8 storage. `error`
    // takes precedence: an errored run's Passed column is meaningless, and
    // the sidebar's "Errored" pill counts `Status = 'error'` — mapping those
    // rows to 'unknown' made the pill filter by the wrong value.
    expression:
      "multiIf(Status = 'error', 'error', Passed = 1, 'pass', Passed = 0, 'fail', 'unknown')",
  },
  {
    key: "evaluatorScore",
    kind: "range",
    label: "Evaluator score",
    group: "evaluation",
    table: "evaluation_runs",
    expression: "Score",
  },
  {
    // Per-evaluator emitted label (e.g. "faithful" / "toxic"). The sidebar
    // drilldown surfaces the top values inline under each evaluator; this
    // registry entry also makes `evaluatorLabel:<value>` a first-class filter
    // field, auto-deriving the cross-table `evaluation_runs.Label` subquery
    // handler — the same wiring as `evaluatorVerdict` above.
    key: "evaluatorLabel",
    kind: "categorical",
    label: "Evaluator label",
    group: "evaluation",
    table: "evaluation_runs",
    expression: "Label",
  },

  // stored_spans: cross-table
  {
    key: "spanType",
    kind: "categorical",
    label: "Span type",
    group: "span",
    table: "stored_spans",
    expression: "SpanAttributes['langwatch.span.type']",
  },
  EVENT_FACET,
  EVENT_ATTRIBUTE_KEYS_FACET,
  SPAN_NAME_FACET,
  SPAN_STATUS_FACET,
  SPAN_ATTRIBUTE_KEYS_FACET,
];
