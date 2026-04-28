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

function buildTimeWhere(timeColumn: string): string {
  return [
    "TenantId = {tenantId:String}",
    `${timeColumn} >= fromUnixTimestamp64Milli({timeFrom:Int64})`,
    `${timeColumn} <= fromUnixTimestamp64Milli({timeTo:Int64})`,
  ].join(" AND ");
}

function baseParams(ctx: FacetQueryContext): Record<string, unknown> {
  return {
    tenantId: ctx.tenantId,
    timeFrom: ctx.timeRange.from,
    timeTo: ctx.timeRange.to,
    limit: ctx.limit,
    offset: ctx.offset,
  };
}

function buildLabelFacetQuery(ctx: FacetQueryContext): FacetQuery {
  const where = buildTimeWhere("OccurredAt");
  const prefixFilter = ctx.prefix
    ? "AND lower(trim(BOTH '\"' FROM label)) ILIKE concat({prefix:String}, '%')"
    : "";

  return {
    sql: `
      SELECT
        trim(BOTH '"' FROM label) AS facet_value,
        count() AS cnt,
        count() OVER () AS total_distinct
      FROM (
        SELECT arrayJoin(JSONExtractArrayRaw(Attributes['langwatch.labels'])) AS label
        FROM trace_summaries
        WHERE ${where}
          AND Attributes['langwatch.labels'] != ''
          AND Attributes['langwatch.labels'] != '[]'
      )
      WHERE label != '' AND label != 'null'
        ${prefixFilter}
      GROUP BY facet_value
      ORDER BY cnt DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    params: {
      ...baseParams(ctx),
      ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
    },
  };
}

function buildMetadataKeysFacetQuery(ctx: FacetQueryContext): FacetQuery {
  const where = buildTimeWhere("OccurredAt");
  const prefixFilter = ctx.prefix
    ? "AND lower(key) ILIKE concat({prefix:String}, '%')"
    : "";

  return {
    sql: `
      SELECT
        key AS facet_value,
        count() AS cnt,
        count() OVER () AS total_distinct
      FROM (
        SELECT arrayJoin(mapKeys(Attributes)) AS key
        FROM trace_summaries
        WHERE ${where}
      )
      WHERE key != ''
        ${prefixFilter}
      GROUP BY key
      ORDER BY cnt DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    params: {
      ...baseParams(ctx),
      ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
    },
  };
}

function buildEventsFacetQuery(ctx: FacetQueryContext): FacetQuery {
  const where = buildTimeWhere("StartTime");
  const prefixFilter = ctx.prefix
    ? "AND lower(name) ILIKE concat({prefix:String}, '%')"
    : "";
  return {
    sql: `
      SELECT
        name AS facet_value,
        count() AS cnt,
        count() OVER () AS total_distinct
      FROM (
        SELECT arrayJoin(\`Events.Name\`) AS name
        FROM stored_spans
        WHERE ${where}
          AND length(\`Events.Name\`) > 0
      )
      WHERE name != ''
        ${prefixFilter}
      GROUP BY name
      ORDER BY cnt DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    params: {
      ...baseParams(ctx),
      ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
    },
  };
}

function buildEvaluatorFacetQuery(ctx: FacetQueryContext): FacetQuery {
  const where = buildTimeWhere("ScheduledAt");
  const prefixFilter = ctx.prefix
    ? "AND lower(ifNull(EvaluatorName, '')) ILIKE concat({prefix:String}, '%')"
    : "";

  return {
    sql: `
      SELECT
        EvaluatorId AS facet_value,
        if(ifNull(EvaluatorName, '') != '',
           concat('[', EvaluatorType, '] ', EvaluatorName),
           concat('[', EvaluatorType, '] ', EvaluatorId)
        ) AS facet_label,
        count() AS cnt,
        count() OVER () AS total_distinct
      FROM evaluation_runs
      WHERE ${where}
        AND ifNull(EvaluatorId, '') != ''
        ${prefixFilter}
      GROUP BY EvaluatorId, EvaluatorType, EvaluatorName
      ORDER BY cnt DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    params: {
      ...baseParams(ctx),
      ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
    },
  };
}

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
    key: "rootSpanName",
    kind: "categorical",
    label: "Root span name",
    group: "trace",
    table: "trace_summaries",
    expression: "RootSpanName",
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
  {
    key: "label",
    kind: "categorical",
    label: "Label",
    group: "trace",
    table: "trace_summaries",
    queryBuilder: buildLabelFacetQuery,
  },

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
    label: "Duration (ms)",
    group: "trace",
    table: "trace_summaries",
    expression: "TotalDurationMs",
  },
  {
    key: "tokens",
    kind: "range",
    label: "Total Tokens",
    group: "trace",
    table: "trace_summaries",
    expression: "TotalPromptTokenCount + TotalCompletionTokenCount",
  },
  {
    key: "ttft",
    kind: "range",
    label: "Time to First Token (ms)",
    group: "trace",
    table: "trace_summaries",
    expression: "TimeToFirstTokenMs",
  },
  {
    key: "ttlt",
    kind: "range",
    label: "Time to Last Token (ms)",
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
    label: "Span Count",
    group: "trace",
    table: "trace_summaries",
    expression: "SpanCount",
  },

  // metadata: dynamic keys
  {
    key: "metadataKeys",
    kind: "dynamic_keys",
    label: "Metadata Keys",
    group: "metadata",
    table: "trace_summaries",
    queryBuilder: buildMetadataKeysFacetQuery,
  },

  // evaluation_runs: cross-table
  {
    key: "evaluator",
    kind: "categorical",
    label: "Evaluator",
    group: "evaluation",
    table: "evaluation_runs",
    queryBuilder: buildEvaluatorFacetQuery,
  },
  {
    key: "evaluatorStatus",
    kind: "categorical",
    label: "Evaluator Status",
    group: "evaluation",
    table: "evaluation_runs",
    expression: "Status",
  },
  {
    key: "evaluatorVerdict",
    kind: "categorical",
    label: "Evaluator Verdict",
    group: "evaluation",
    table: "evaluation_runs",
    // Surface a 3-way label so users can pick pass / fail / unknown without
    // dealing with the 0/1/null underlying UInt8 storage.
    expression: "if(Passed = 1, 'pass', if(Passed = 0, 'fail', 'unknown'))",
  },
  {
    key: "evaluatorScore",
    kind: "range",
    label: "Evaluator Score",
    group: "evaluation",
    table: "evaluation_runs",
    expression: "Score",
  },

  // stored_spans: cross-table
  {
    key: "spanType",
    kind: "categorical",
    label: "Span Type",
    group: "span",
    table: "stored_spans",
    expression: "SpanAttributes['langwatch.span.type']",
  },
  {
    // Surfaces span event names from the `Events.Name` array.
    // Key matches the `event:` filter handler so toggles round-trip cleanly.
    key: "event",
    kind: "categorical",
    label: "Event",
    group: "span",
    table: "stored_spans",
    queryBuilder: buildEventsFacetQuery,
  },
];
