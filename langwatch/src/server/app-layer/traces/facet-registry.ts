import {
  EVALUATOR_FACET,
  EVENT_ATTRIBUTE_KEYS_FACET,
  EVENT_FACET,
  LABEL_FACET,
  METADATA_KEYS_FACET,
  SPAN_ATTRIBUTE_KEYS_FACET,
  SPAN_NAME_FACET,
  SPAN_STATUS_FACET,
} from "./facets";

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
}

export interface QueryBuilderCategoricalDef extends BaseFacetDef {
  kind: "categorical";
  queryBuilder: (ctx: FacetQueryContext) => FacetQuery;
}

export interface RangeFacetDef extends BaseFacetDef {
  kind: "range";
  expression: string;
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
    expression:
      "if(ContainsErrorStatus = 1, 'error', if(ContainsOKStatus = 1, 'ok', 'warning'))",
  },
  {
    key: "origin",
    kind: "categorical",
    label: "Origin",
    group: "trace",
    table: "trace_summaries",
    expression: "Attributes['langwatch.origin']",
  },
  {
    key: "service",
    kind: "categorical",
    label: "Service",
    group: "trace",
    table: "trace_summaries",
    expression: "Attributes['service.name']",
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
  },
  {
    key: "conversation",
    kind: "categorical",
    label: "Conversation",
    group: "trace",
    table: "trace_summaries",
    expression: "Attributes['gen_ai.conversation.id']",
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
  },
  {
    key: "subtopic",
    kind: "categorical",
    label: "Subtopic",
    group: "trace",
    table: "trace_summaries",
    expression: "SubTopicId",
  },
  {
    key: "traceName",
    kind: "categorical",
    label: "Trace name",
    group: "trace",
    table: "trace_summaries",
    expression: "TraceName",
  },
  {
    key: "rootSpanType",
    kind: "categorical",
    label: "Root span type",
    group: "trace",
    table: "trace_summaries",
    expression: "RootSpanType",
  },
  {
    key: "guardrail",
    kind: "categorical",
    label: "Guardrail",
    group: "trace",
    table: "trace_summaries",
    expression: "if(BlockedByGuardrail, 'blocked', 'allowed')",
  },
  {
    key: "annotation",
    kind: "categorical",
    label: "Annotation",
    group: "trace",
    table: "trace_summaries",
    expression: "if(HasAnnotation, 'annotated', 'unannotated')",
  },
  {
    key: "containsAi",
    kind: "categorical",
    label: "Contains AI",
    group: "trace",
    table: "trace_summaries",
    expression: "if(ContainsAi, 'yes', 'no')",
  },
  {
    key: "errorMessage",
    kind: "categorical",
    label: "Error message",
    group: "trace",
    table: "trace_summaries",
    expression: "ErrorMessage",
  },
  {
    key: "tokensEstimated",
    kind: "categorical",
    label: "Tokens estimated",
    group: "trace",
    table: "trace_summaries",
    expression: "if(TokensEstimated, 'estimated', 'actual')",
  },

  // trace_summaries: prompt facets (rolled up at ingest from span attributes)
  {
    key: "selectedPrompt",
    kind: "categorical",
    label: "Selected prompt",
    group: "prompt",
    table: "trace_summaries",
    expression: "SelectedPromptId",
  },
  {
    key: "lastUsedPrompt",
    kind: "categorical",
    label: "Last used prompt",
    group: "prompt",
    table: "trace_summaries",
    expression: "LastUsedPromptId",
  },
  {
    key: "promptVersion",
    kind: "range",
    label: "Prompt version",
    group: "prompt",
    table: "trace_summaries",
    expression: "LastUsedPromptVersionNumber",
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
  },
  {
    key: "tokens",
    kind: "range",
    label: "Total tokens",
    group: "trace",
    table: "trace_summaries",
    expression: "TotalPromptTokenCount + TotalCompletionTokenCount",
  },
  {
    key: "ttft",
    kind: "range",
    label: "Time to first token",
    group: "trace",
    table: "trace_summaries",
    expression: "TimeToFirstTokenMs",
  },
  {
    key: "ttlt",
    kind: "range",
    label: "Time to last token",
    group: "trace",
    table: "trace_summaries",
    expression: "TimeToLastTokenMs",
  },
  {
    key: "promptTokens",
    kind: "range",
    label: "Prompt tokens",
    group: "trace",
    table: "trace_summaries",
    expression: "TotalPromptTokenCount",
  },
  {
    key: "completionTokens",
    kind: "range",
    label: "Completion tokens",
    group: "trace",
    table: "trace_summaries",
    expression: "TotalCompletionTokenCount",
  },
  {
    key: "tokensPerSecond",
    kind: "range",
    label: "Tokens / second",
    group: "trace",
    table: "trace_summaries",
    expression: "TokensPerSecond",
  },
  {
    key: "spans",
    kind: "range",
    label: "Span count",
    group: "trace",
    table: "trace_summaries",
    expression: "SpanCount",
  },

  // metadata: dynamic keys
  METADATA_KEYS_FACET,

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
    // Surface a 3-way label so users can pick pass / fail / unknown without
    // dealing with the 0/1/null underlying UInt8 storage.
    expression: "if(Passed = 1, 'pass', if(Passed = 0, 'fail', 'unknown'))",
  },
  {
    key: "evaluatorScore",
    kind: "range",
    label: "Evaluator score",
    group: "evaluation",
    table: "evaluation_runs",
    expression: "Score",
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
