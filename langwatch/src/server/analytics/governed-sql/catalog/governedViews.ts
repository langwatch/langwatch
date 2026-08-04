/**
 * Governed analytics SQL — the `analytics.*` schema catalog.
 *
 * One entry per governed view. This is the whole public surface of the
 * analytics SQL API: a caller can name these views and these columns, and
 * nothing else, because the grants the entries generate expose nothing else.
 *
 * ## What is deliberately absent
 *
 * Free-text carriers with no gate in the canonical visibility policy are not
 * exposed at all — `trace_summaries.ErrorMessage`, `evaluation_runs.Error` and
 * `ErrorDetails`, `stored_spans.StatusMessage`, and the whole `Events.*` nested
 * group on spans. Each of them routinely quotes the payload that produced the
 * failure, and the data-privacy policy has no rule that would gate them, so
 * exposing them would mean inventing a gate rather than deriving one. They are
 * off-catalog, which under the column grants means unreachable rather than
 * merely unselected.
 *
 * Event-sourcing bookkeeping (`ProjectionId`, `Version`, `LastProcessedEventId`,
 * `LastEventOccurredAt`, `CreatedAt`) is absent for the same structural reason
 * and a different substantive one: it describes how a row got written, which is
 * not something the API promises to keep stable.
 *
 * ## Grain
 *
 * Every source table is a `ReplacingMergeTree` carrying more than one version
 * of a row until merges catch up, so each view deduplicates and each entry
 * states the identity of the row that survives. See `../views.ts` for how, and
 * for the measurement behind the choice.
 *
 * @see ./types.ts — the shapes, and the derivations the validator reads
 * @see specs/analytics/governed-sql-api.feature
 */

import { contentFilteredMapSql } from "./contentGating";
import type { GovernedViewDefinition } from "./types";

/**
 * How long after a write a row can be missing from these views.
 *
 * The projections are folded by the event-sourcing pipeline, so the number the
 * schema endpoint publishes is about that pipeline, not about ClickHouse.
 */
const PROJECTION_FRESHNESS = "seconds behind ingestion";

/** Traces: one row per trace, the summary the fold maintains. */
const TRACES: GovernedViewDefinition = {
  name: "traces",
  sourceTable: "trace_summaries",
  description:
    "One row per trace, with its timing, token, cost and error rollups.",
  gates: [],
  grain: "one row per (TenantId, TraceId), latest version only",
  joinKeys: ["TenantId", "TraceId"],
  timeColumn: "OccurredAt",
  freshness: PROJECTION_FRESHNESS,
  dedup: { keyColumns: ["TenantId", "TraceId"], versionColumn: "UpdatedAt" },
  columns: [
    {
      name: "TenantId",
      type: "String",
      description: "Project the trace belongs to.",
      gates: [],
      sourceColumns: ["TenantId"],
    },
    {
      name: "TraceId",
      type: "String",
      description: "Trace identifier, unique within the project.",
      gates: [],
      sourceColumns: ["TraceId"],
    },
    {
      name: "TraceName",
      type: "String",
      description: "Display name of the trace, empty when none was recorded.",
      gates: [],
      sourceColumns: ["TraceName"],
    },
    {
      name: "OccurredAt",
      type: "DateTime64(3)",
      description:
        "When the trace started. Filter on this to prune partitions.",
      gates: [],
      sourceColumns: ["OccurredAt"],
    },
    {
      name: "UpdatedAt",
      type: "DateTime64(3)",
      description: "When this version of the summary was written.",
      gates: [],
      sourceColumns: ["UpdatedAt"],
    },
    {
      name: "TotalDurationMs",
      type: "Int64",
      unit: "ms",
      description: "Wall-clock duration of the whole trace, in milliseconds.",
      gates: [],
      sourceColumns: ["TotalDurationMs"],
    },
    {
      name: "TimeToFirstTokenMs",
      type: "Nullable(UInt32)",
      unit: "ms",
      description: "Milliseconds until the first generated token.",
      gates: [],
      sourceColumns: ["TimeToFirstTokenMs"],
    },
    {
      name: "TimeToLastTokenMs",
      type: "Nullable(UInt32)",
      unit: "ms",
      description: "Milliseconds until the last generated token.",
      gates: [],
      sourceColumns: ["TimeToLastTokenMs"],
    },
    {
      name: "TokensPerSecond",
      type: "Nullable(UInt32)",
      unit: "tokens/s",
      description: "Generation throughput over the trace.",
      gates: [],
      sourceColumns: ["TokensPerSecond"],
    },
    {
      name: "SpanCount",
      type: "UInt32",
      description: "Number of spans recorded under the trace.",
      gates: [],
      sourceColumns: ["SpanCount"],
    },
    {
      name: "ContainsErrorStatus",
      type: "Bool",
      description: "Whether any span of the trace ended in an error status.",
      gates: [],
      sourceColumns: ["ContainsErrorStatus"],
    },
    {
      name: "ContainsOKStatus",
      type: "Bool",
      description: "Whether any span of the trace ended in an OK status.",
      gates: [],
      sourceColumns: ["ContainsOKStatus"],
    },
    {
      name: "Models",
      type: "Array(String)",
      description: "Every model used anywhere in the trace.",
      gates: [],
      sourceColumns: ["Models"],
    },
    {
      name: "TotalCost",
      type: "Nullable(Float64)",
      unit: "USD",
      description: "Billed cost of the trace, in USD.",
      gates: ["costs"],
      sourceColumns: ["TotalCost"],
    },
    {
      name: "TokensEstimated",
      type: "Bool",
      description:
        "Whether token counts were estimated rather than reported by the provider.",
      gates: [],
      sourceColumns: ["TokensEstimated"],
    },
    {
      name: "TotalPromptTokenCount",
      type: "Nullable(UInt32)",
      unit: "tokens",
      description: "Prompt tokens across the trace.",
      gates: [],
      sourceColumns: ["TotalPromptTokenCount"],
    },
    {
      name: "TotalCompletionTokenCount",
      type: "Nullable(UInt32)",
      unit: "tokens",
      description: "Completion tokens across the trace.",
      gates: [],
      sourceColumns: ["TotalCompletionTokenCount"],
    },
    {
      name: "SatisfactionScore",
      type: "Nullable(Float64)",
      description: "Derived satisfaction score, when one was computed.",
      gates: [],
      sourceColumns: ["SatisfactionScore"],
    },
    {
      name: "TopicId",
      type: "Nullable(String)",
      description: "Topic the trace was clustered into.",
      gates: [],
      sourceColumns: ["TopicId"],
    },
    {
      name: "SubTopicId",
      type: "Nullable(String)",
      description: "Sub-topic the trace was clustered into.",
      gates: [],
      sourceColumns: ["SubTopicId"],
    },
    {
      name: "HasAnnotation",
      type: "Nullable(Bool)",
      description: "Whether a reviewer annotated the trace.",
      gates: [],
      sourceColumns: ["HasAnnotation"],
    },
    {
      name: "ContainsPrompt",
      type: "Bool",
      description: "Whether the trace used a managed prompt.",
      gates: [],
      sourceColumns: ["ContainsPrompt"],
    },
    {
      name: "SelectedPromptId",
      type: "Nullable(String)",
      description: "Managed prompt selected for the trace.",
      gates: [],
      sourceColumns: ["SelectedPromptId"],
    },
    {
      name: "LastUsedPromptId",
      type: "Nullable(String)",
      description: "Last managed prompt used in the trace.",
      gates: [],
      sourceColumns: ["LastUsedPromptId"],
    },
    {
      name: "LastUsedPromptVersionId",
      type: "Nullable(String)",
      description: "Version of the last managed prompt used.",
      gates: [],
      sourceColumns: ["LastUsedPromptVersionId"],
    },
    {
      name: "LastUsedPromptVersionNumber",
      type: "Nullable(UInt32)",
      description: "Version number of the last managed prompt used.",
      gates: [],
      sourceColumns: ["LastUsedPromptVersionNumber"],
    },
    {
      name: "SourceType",
      type: "LowCardinality(String)",
      description: "Which product surface produced the trace.",
      gates: [],
      sourceColumns: ["SourceType"],
    },
    {
      name: "Attributes",
      type: "Map(String, String)",
      description:
        "Trace-level attributes, with every captured-content key removed.",
      gates: [],
      sourceColumns: ["Attributes"],
      expression: (source) => contentFilteredMapSql(source("Attributes")),
    },
    {
      name: "CapturedInput",
      type: "Nullable(String)",
      description: "The trace's captured input.",
      gates: ["input"],
      sourceColumns: ["ComputedInput"],
    },
    {
      name: "CapturedOutput",
      type: "Nullable(String)",
      description: "The trace's captured output.",
      gates: ["output"],
      sourceColumns: ["ComputedOutput"],
    },
  ],
};

/** Spans: one row per span, the OpenTelemetry record as stored. */
const SPANS: GovernedViewDefinition = {
  name: "spans",
  sourceTable: "stored_spans",
  description: "One row per span, with its timing, status and attributes.",
  gates: [],
  grain: "one row per (TenantId, TraceId, SpanId), latest version only",
  joinKeys: ["TenantId", "TraceId", "SpanId"],
  timeColumn: "StartTime",
  freshness: PROJECTION_FRESHNESS,
  dedup: {
    keyColumns: ["TenantId", "TraceId", "SpanId"],
    // Not `UpdatedAt`: `stored_spans` is `ReplacingMergeTree(StartTime)`, so
    // `StartTime` is what the engine itself collapses on. Deduplicating on a
    // different column than the engine does would disagree with a merged part.
    versionColumn: "StartTime",
  },
  columns: [
    {
      name: "TenantId",
      type: "String",
      description: "Project the span belongs to.",
      gates: [],
      sourceColumns: ["TenantId"],
    },
    {
      name: "TraceId",
      type: "String",
      description: "Trace the span belongs to.",
      gates: [],
      sourceColumns: ["TraceId"],
    },
    {
      name: "SpanId",
      type: "String",
      description: "Span identifier, unique within the trace.",
      gates: [],
      sourceColumns: ["SpanId"],
    },
    {
      name: "ParentSpanId",
      type: "Nullable(String)",
      description: "Parent span, null for the root span.",
      gates: [],
      sourceColumns: ["ParentSpanId"],
    },
    {
      name: "StartTime",
      type: "DateTime64(3)",
      description: "When the span started. Filter on this to prune partitions.",
      gates: [],
      sourceColumns: ["StartTime"],
    },
    {
      name: "EndTime",
      type: "DateTime64(3)",
      description: "When the span ended.",
      gates: [],
      sourceColumns: ["EndTime"],
    },
    {
      name: "DurationMs",
      type: "UInt64",
      unit: "ms",
      description: "Span duration in milliseconds.",
      gates: [],
      sourceColumns: ["DurationMs"],
    },
    {
      name: "SpanName",
      type: "LowCardinality(String)",
      description: "Operation name of the span.",
      gates: [],
      sourceColumns: ["SpanName"],
    },
    {
      name: "SpanKind",
      type: "UInt8",
      description: "OpenTelemetry span kind.",
      gates: [],
      sourceColumns: ["SpanKind"],
    },
    {
      name: "ServiceName",
      type: "LowCardinality(String)",
      description: "Service that emitted the span.",
      gates: [],
      sourceColumns: ["ServiceName"],
    },
    {
      name: "ScopeName",
      type: "String",
      description: "Instrumentation scope that emitted the span.",
      gates: [],
      sourceColumns: ["ScopeName"],
    },
    {
      name: "StatusCode",
      type: "Nullable(UInt8)",
      description: "OpenTelemetry status code.",
      gates: [],
      sourceColumns: ["StatusCode"],
    },
    {
      name: "Sampled",
      type: "UInt8",
      description: "Whether the span was sampled in.",
      gates: [],
      sourceColumns: ["Sampled"],
    },
    {
      name: "Cost",
      type: "Nullable(Float64)",
      unit: "USD",
      description: "Billed cost attributed to the span, in USD.",
      gates: ["costs"],
      sourceColumns: ["Cost"],
    },
    {
      name: "NonBilledCost",
      type: "Nullable(Float64)",
      unit: "USD",
      description: "Cost attributed to the span that is not billed, in USD.",
      gates: ["costs"],
      sourceColumns: ["NonBilledCost"],
    },
    {
      name: "SpanAttributes",
      // Not the source's `Map(LowCardinality(String), String)`: `mapFilter`
      // returns a plain-keyed map, and the catalog publishes what the view
      // returns rather than what the table stores.
      type: "Map(String, String)",
      description:
        "Span attributes, with every captured-content key removed. Content is reachable only through CapturedInput and CapturedOutput.",
      gates: [],
      sourceColumns: ["SpanAttributes"],
      expression: (source) => contentFilteredMapSql(source("SpanAttributes")),
    },
    {
      name: "ResourceAttributes",
      type: "Map(String, String)",
      description:
        "Resource attributes, with every captured-content key removed.",
      gates: [],
      sourceColumns: ["ResourceAttributes"],
      expression: (source) =>
        contentFilteredMapSql(source("ResourceAttributes")),
    },
    {
      name: "CapturedInput",
      type: "String",
      description:
        "The span's captured input, in LangWatch's canonical attribute. Empty when the span recorded none.",
      gates: ["input"],
      sourceColumns: ["SpanAttributes"],
      expression: (source) => `${source("SpanAttributes")}['langwatch.input']`,
    },
    {
      name: "CapturedOutput",
      type: "String",
      description:
        "The span's captured output, in LangWatch's canonical attribute. Empty when the span recorded none.",
      gates: ["output"],
      sourceColumns: ["SpanAttributes"],
      expression: (source) => `${source("SpanAttributes")}['langwatch.output']`,
    },
  ],
};

/** Evaluations: one row per evaluation run. */
const EVALUATIONS: GovernedViewDefinition = {
  name: "evaluations",
  sourceTable: "evaluation_runs",
  description: "One row per evaluation run, with its score and outcome.",
  gates: [],
  grain: "one row per (TenantId, EvaluationId), latest version only",
  joinKeys: ["TenantId", "TraceId"],
  timeColumn: "ScheduledAt",
  freshness: PROJECTION_FRESHNESS,
  dedup: {
    keyColumns: ["TenantId", "EvaluationId"],
    versionColumn: "UpdatedAt",
  },
  columns: [
    {
      name: "TenantId",
      type: "String",
      description: "Project the evaluation belongs to.",
      gates: [],
      sourceColumns: ["TenantId"],
    },
    {
      name: "EvaluationId",
      type: "String",
      description: "Evaluation run identifier.",
      gates: [],
      sourceColumns: ["EvaluationId"],
    },
    {
      name: "TraceId",
      type: "Nullable(String)",
      description: "Trace the evaluation ran against, when it ran against one.",
      gates: [],
      sourceColumns: ["TraceId"],
    },
    {
      name: "EvaluatorId",
      type: "String",
      description: "Evaluator that produced the result.",
      gates: [],
      sourceColumns: ["EvaluatorId"],
    },
    {
      name: "EvaluatorType",
      type: "LowCardinality(String)",
      description: "Kind of evaluator.",
      gates: [],
      sourceColumns: ["EvaluatorType"],
    },
    {
      name: "EvaluatorName",
      type: "Nullable(String)",
      description: "Display name of the evaluator.",
      gates: [],
      sourceColumns: ["EvaluatorName"],
    },
    {
      name: "IsGuardrail",
      type: "UInt8",
      description: "Whether the evaluator ran as a guardrail.",
      gates: [],
      sourceColumns: ["IsGuardrail"],
    },
    {
      name: "Status",
      type: "LowCardinality(String)",
      description: "Terminal state of the run: processed, skipped, or error.",
      gates: [],
      sourceColumns: ["Status"],
    },
    {
      name: "Score",
      type: "Nullable(Float64)",
      description: "Numeric score, when the evaluator produced one.",
      gates: [],
      sourceColumns: ["Score"],
    },
    {
      name: "Passed",
      type: "Nullable(UInt8)",
      description: "Pass/fail outcome, when the evaluator produced one.",
      gates: [],
      sourceColumns: ["Passed"],
    },
    {
      name: "Label",
      type: "Nullable(String)",
      description: "Categorical outcome, when the evaluator produced one.",
      gates: [],
      sourceColumns: ["Label"],
    },
    {
      name: "Details",
      type: "Nullable(String)",
      description: "The evaluator's explanation of its result.",
      gates: [],
      sourceColumns: ["Details"],
    },
    {
      name: "ScheduledAt",
      type: "DateTime64(3)",
      description:
        "When the run was scheduled. Filter on this to prune partitions.",
      gates: [],
      sourceColumns: ["ScheduledAt"],
    },
    {
      name: "StartedAt",
      type: "Nullable(DateTime64(3))",
      description: "When the run started.",
      gates: [],
      sourceColumns: ["StartedAt"],
    },
    {
      name: "CompletedAt",
      type: "Nullable(DateTime64(3))",
      description: "When the run finished.",
      gates: [],
      sourceColumns: ["CompletedAt"],
    },
    {
      name: "UpdatedAt",
      type: "DateTime64(3)",
      description: "When this version of the run was written.",
      gates: [],
      sourceColumns: ["UpdatedAt"],
    },
    {
      name: "ArchivedAt",
      type: "Nullable(DateTime64(3))",
      description: "When the run was archived, null while it is live.",
      gates: [],
      sourceColumns: ["ArchivedAt"],
    },
    {
      name: "CapturedInputs",
      type: "Nullable(String)",
      description: "The payload the evaluator was given.",
      gates: ["input"],
      sourceColumns: ["Inputs"],
    },
  ],
};

/** Simulations: one row per scenario run. */
const SIMULATIONS: GovernedViewDefinition = {
  name: "simulations",
  sourceTable: "simulation_runs",
  description: "One row per simulation run, with its verdict and criteria.",
  gates: [],
  grain: "one row per (TenantId, ScenarioRunId), latest version only",
  joinKeys: ["TenantId", "ScenarioRunId"],
  timeColumn: "StartedAt",
  freshness: PROJECTION_FRESHNESS,
  dedup: {
    keyColumns: ["TenantId", "ScenarioRunId"],
    versionColumn: "UpdatedAt",
  },
  columns: [
    {
      name: "TenantId",
      type: "String",
      description: "Project the run belongs to.",
      gates: [],
      sourceColumns: ["TenantId"],
    },
    {
      name: "ScenarioRunId",
      type: "String",
      description: "Simulation run identifier.",
      gates: [],
      sourceColumns: ["ScenarioRunId"],
    },
    {
      name: "ScenarioId",
      type: "String",
      description: "Scenario the run exercised.",
      gates: [],
      sourceColumns: ["ScenarioId"],
    },
    {
      name: "BatchRunId",
      type: "String",
      description: "Batch the run belonged to.",
      gates: [],
      sourceColumns: ["BatchRunId"],
    },
    {
      name: "ScenarioSetId",
      type: "String",
      description: "Set the scenario belongs to.",
      gates: [],
      sourceColumns: ["ScenarioSetId"],
    },
    {
      name: "Status",
      type: "String",
      description: "Terminal state of the run.",
      gates: [],
      sourceColumns: ["Status"],
    },
    {
      name: "Name",
      type: "Nullable(String)",
      description: "Display name of the scenario.",
      gates: [],
      sourceColumns: ["Name"],
    },
    {
      name: "Verdict",
      type: "Nullable(String)",
      description: "The judge's verdict on the run.",
      gates: [],
      sourceColumns: ["Verdict"],
    },
    {
      name: "MetCriteria",
      type: "Array(String)",
      description: "Criteria the run satisfied.",
      gates: [],
      sourceColumns: ["MetCriteria"],
    },
    {
      name: "UnmetCriteria",
      type: "Array(String)",
      description: "Criteria the run failed.",
      gates: [],
      sourceColumns: ["UnmetCriteria"],
    },
    {
      name: "TraceIds",
      type: "Array(String)",
      description: "Traces recorded while the run executed.",
      gates: [],
      sourceColumns: ["TraceIds"],
    },
    {
      name: "DurationMs",
      type: "Nullable(UInt64)",
      unit: "ms",
      description: "How long the run took, in milliseconds.",
      gates: [],
      sourceColumns: ["DurationMs"],
    },
    {
      name: "StartedAt",
      type: "DateTime64(3)",
      description: "When the run started. Filter on this to prune partitions.",
      gates: [],
      sourceColumns: ["StartedAt"],
    },
    {
      name: "FinishedAt",
      type: "Nullable(DateTime64(3))",
      description: "When the run finished.",
      gates: [],
      sourceColumns: ["FinishedAt"],
    },
    {
      name: "UpdatedAt",
      type: "DateTime64(3)",
      description: "When this version of the run was written.",
      gates: [],
      sourceColumns: ["UpdatedAt"],
    },
    {
      name: "ArchivedAt",
      type: "Nullable(DateTime64(3))",
      description: "When the run was archived, null while it is live.",
      gates: [],
      sourceColumns: ["ArchivedAt"],
    },
    {
      name: "MessageContents",
      type: "Array(String)",
      description:
        "What was said in the simulated conversation, in message order.",
      // Both gates: a transcript is what the user said *and* what the model
      // answered, so it is readable only by a caller permitted to see both.
      gates: ["input", "output"],
      sourceColumns: ["Messages.Content"],
      expression: (source) => source("Messages.Content"),
    },
    {
      name: "MessageRoles",
      type: "Array(String)",
      description:
        "Role of each message in the simulated conversation, in the same order as MessageContents.",
      gates: [],
      sourceColumns: ["Messages.Role"],
      expression: (source) => source("Messages.Role"),
    },
    {
      name: "Reasoning",
      type: "Nullable(String)",
      description: "The judge's reasoning about the conversation.",
      // Gated like an annotation comment (`traces/projection/catalog.ts`): a
      // reviewer's free text about a response routinely quotes the response.
      gates: ["output"],
      sourceColumns: ["Reasoning"],
    },
  ],
};

/**
 * The governed schema, in the order the schema endpoint should publish it.
 *
 * Everything the issue enumerates that is not here — generations, sessions,
 * experiment runs, annotations and the by-name dimension joins — needs either a
 * derived view over these tables or the PostgreSQL mapping, and lands with the
 * slices that build them.
 */
export const GOVERNED_VIEW_CATALOG: readonly GovernedViewDefinition[] = [
  TRACES,
  SPANS,
  EVALUATIONS,
  SIMULATIONS,
];

/** Looks a view up by the name a caller writes. */
export function governedViewByName(
  name: string,
): GovernedViewDefinition | undefined {
  return GOVERNED_VIEW_CATALOG.find((view) => view.name === name);
}
