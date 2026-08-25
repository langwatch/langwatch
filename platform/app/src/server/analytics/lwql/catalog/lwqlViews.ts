/**
 * LangWatchQL analytics SQL — the `analytics.*` schema catalog.
 *
 * One entry per LangWatchQL view. This is the whole public surface of the
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
 * `LastEventOccurredAt`, `CreatedAt`, `EarliestSpanStartMs`, `_retention_days`)
 * is absent for the same structural reason and a different substantive one: it
 * describes how a row got written or how long it is kept, which is not
 * something the API promises to keep stable.
 *
 * ## Two datasets over one trace, and why that is not two answers
 *
 * `traces` and `trace_metrics` are both one row per trace, and `evaluations`
 * and `evaluation_metrics` are both one row per evaluation, because the write
 * path maintains two projections of each. They are folded from the *same*
 * events by the *same* services, so the values they share agree; what differs
 * is which questions each is shaped for, and each carries columns the other
 * does not:
 *
 *  - `traces` / `evaluations` are the complete record — captured input and
 *    output, prompt lineage, the evaluator's explanation — sorted for point
 *    lookups by id.
 *  - `trace_metrics` / `evaluation_metrics` are the analytics projections:
 *    time-sorted for range scans, carrying the hoisted `UserId`,
 *    `ConversationId`, `CustomerId` and `Origin` dimensions, and carrying no
 *    captured content at all because the fold never writes any onto them.
 *  - `trace_metrics_by_minute` / `evaluation_metrics_by_minute` are
 *    pre-aggregated per minute, for a metric a caller wants without touching
 *    per-row data.
 *
 * Note the `_by_minute` rollups count only what was final when the row was
 * written: a trace contributes to `TraceCount` through its root span, so a
 * trace whose root span never arrived contributes sums and no count. A
 * distinct-trace count is a question for `trace_metrics`.
 *
 * ## Grain
 *
 * Most source tables are `ReplacingMergeTree`s carrying more than one version
 * of a row until merges catch up, so each view deduplicates and each entry
 * states two things about its rows. `dedup.keyColumns` is the source's whole
 * `ORDER BY` — the key the *engine* collapses on, which is what `FINAL` can
 * promise and nothing more. `grainColumns` is what one row of the *dataset* is,
 * declared only where the two differ, which is where the sort key leads with a
 * business time so that range scans are monotonic. Both analytics projections
 * are sorted that way, and they answer it differently: `trace_analytics` freezes
 * its `OccurredAt` as a storage anchor, so the engine's key and the trace are
 * the same row, while `evaluation_analytics` writes its progress watermark into
 * `OccurredAt`, which moves — so that entry pins the `in-tuple` strategy and is
 * deduplicated by the evaluation rather than by the engine's key.
 *
 * The `_by_minute` rollups are `AggregatingMergeTree`s instead, whose rows for
 * one key are summed rather than superseded — which their entries declare,
 * because reading one as if it had versions would expose each unmerged partial
 * row as its own answer. Their measures declare `summed` and the cast back to a
 * plain type is derived from it. See `../views.ts` for how, and for the
 * measurement behind the default.
 *
 * @see ./types.ts — the shapes, and the derivations the validator reads
 * @see specs/analytics/lwql-api.feature
 */

import { contentFilteredMapSql } from "./contentGating";
import { LWQL_POSTGRES_CATALOG } from "./postgresViews";
import type { LangWatchQLViewDefinition } from "./types";

/**
 * How long after a write a row can be missing from these views.
 *
 * The projections are folded by the event-sourcing pipeline, so the number the
 * schema endpoint publishes is about that pipeline, not about ClickHouse.
 */
const PROJECTION_FRESHNESS = "seconds behind ingestion";

/** Traces: one row per trace, the summary the fold maintains. */
const TRACES: LangWatchQLViewDefinition = {
  name: "traces",
  sourceTable: "trace_summaries",
  description: "One row per trace, with its timing, token, cost and error rollups.",
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
      description: "When the trace started. Filter on this to prune partitions.",
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
    // `HasAnnotation` is deliberately not exposed, and it is the one absence
    // here that is about agreement rather than about sensitivity. It is folded
    // from `trace_summaries.AnnotationIds`, a *best-effort* dual-write of the
    // annotation ids, while the `annotations` dataset reads PostgreSQL
    // directly. Publishing both would let one caller ask "how many traces were
    // annotated" two ways and get two answers, with nothing in the schema
    // saying which is authoritative. The authoritative one is `annotations`:
    //   SELECT count(DISTINCT a.TraceId) FROM analytics.annotations AS a
    // The column itself stays on the fact table — the product's has-annotation
    // filter reads it — so this removes the second *source*, not the projection.
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
      description: "Trace-level attributes, with every captured-content key removed.",
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
const SPANS: LangWatchQLViewDefinition = {
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
      description: "Resource attributes, with every captured-content key removed.",
      gates: [],
      sourceColumns: ["ResourceAttributes"],
      expression: (source) => contentFilteredMapSql(source("ResourceAttributes")),
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
const EVALUATIONS: LangWatchQLViewDefinition = {
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
      // Free text produced while processing the captured input and output —
      // an LLM judge's explanation routinely quotes the conversation it
      // scored — so it carries both content gates rather than shipping the
      // one ungated free-text carrier in the catalog.
      gates: ["input", "output"],
      sourceColumns: ["Details"],
    },
    {
      name: "ScheduledAt",
      type: "DateTime64(3)",
      description: "When the run was scheduled. Filter on this to prune partitions.",
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
const SIMULATIONS: LangWatchQLViewDefinition = {
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
      description: "What was said in the simulated conversation, in message order.",
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
 * Trace metrics: one row per trace, the analytics projection of the same fold.
 *
 * One row per trace is the *grain*; the source's `ORDER BY` is wider, leading
 * with `OccurredAt` so that range scans are monotonic over a part. The two
 * agree for every row the current fold writes, because `OccurredAt` here is a
 * storage anchor written once and frozen (migration 00061, ADR-071). Where they
 * can still come apart is a row written before that freeze, or one whose anchor
 * a post-miss rebuild re-stamped: those carry two `OccurredAt`s, which the
 * engine reads as two keys and `FINAL` therefore keeps — so `uniqExact(TraceId)`
 * is the honest way to count traces here, as the description says.
 */
const TRACE_METRICS: LangWatchQLViewDefinition = {
  name: "trace_metrics",
  sourceTable: "trace_analytics",
  description:
    "One row per trace, time-sorted, carrying its metrics and the user, conversation, customer and origin dimensions. Count traces with uniqExact(TraceId).",
  gates: [],
  grain:
    "one row per (TenantId, OccurredAt, TraceId), latest version only; one row per trace wherever OccurredAt held still",
  // No `grainColumns`: `FINAL` merges on the sort key and nothing narrower, so
  // declaring `(TenantId, TraceId)` would publish a grain the engine cannot
  // deliver — a pre-freeze row whose anchor moved carries two `OccurredAt`s and
  // comes back as two rows (see the doc above). The join below is still the
  // right one; the fanout diagnostic honestly reporting `OccurredAt` unmatched
  // is the price of not overstating the grain.
  joinKeys: ["TenantId", "TraceId"],
  timeColumn: "OccurredAt",
  freshness: PROJECTION_FRESHNESS,
  dedup: {
    keyColumns: ["TenantId", "OccurredAt", "TraceId"],
    versionColumn: "UpdatedAt",
  },
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
      name: "OccurredAt",
      type: "DateTime64(3)",
      description:
        "When the trace was first observed. Filter on this to prune partitions.",
      gates: [],
      sourceColumns: ["OccurredAt"],
    },
    {
      name: "UpdatedAt",
      type: "DateTime64(3)",
      description: "When this version of the row was written.",
      gates: [],
      sourceColumns: ["UpdatedAt"],
    },
    {
      name: "TraceName",
      type: "String",
      description: "Display name of the trace, empty when none was recorded.",
      gates: [],
      sourceColumns: ["TraceName"],
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
    // The three identifiers below name the *customer's* end user, thread and
    // account, not a LangWatch colleague — they are the dimensions the product
    // groups by, hoisted out of the attribute map onto typed columns. The
    // data-privacy catalog classifies none of the attributes they come from as
    // content ("metadata keys … are deliberately absent", `dropKeyCatalog.ts`),
    // so they already survive a content drop and reach a caller through
    // `Attributes` today. Withholding the typed column would gate one spelling
    // of a value and not the other.
    {
      name: "UserId",
      type: "Nullable(String)",
      description: "End user the trace was recorded for, as the SDK reported.",
      gates: [],
      sourceColumns: ["UserId"],
    },
    {
      name: "ConversationId",
      type: "Nullable(String)",
      description: "Conversation or thread the trace belongs to.",
      gates: [],
      sourceColumns: ["ConversationId"],
    },
    {
      name: "CustomerId",
      type: "Nullable(String)",
      description: "Customer account the trace was recorded for.",
      gates: [],
      sourceColumns: ["CustomerId"],
    },
    {
      name: "Origin",
      type: "String",
      description: "Which product surface produced the trace.",
      gates: [],
      sourceColumns: ["Origin"],
    },
    {
      name: "Models",
      type: "Array(String)",
      description: "Every model used anywhere in the trace.",
      gates: [],
      sourceColumns: ["Models"],
    },
    {
      name: "Labels",
      type: "Array(String)",
      description: "Labels the SDK attached to the trace.",
      gates: [],
      sourceColumns: ["Labels"],
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
      name: "NonBilledCost",
      type: "Nullable(Float64)",
      unit: "USD",
      description: "Cost of the trace that is not billed, in USD.",
      gates: ["costs"],
      sourceColumns: ["NonBilledCost"],
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
      name: "TokensPerSecond",
      type: "Nullable(UInt32)",
      unit: "tokens/s",
      description: "Generation throughput over the trace.",
      gates: [],
      sourceColumns: ["TokensPerSecond"],
    },
    {
      name: "PromptTokens",
      type: "Nullable(UInt32)",
      unit: "tokens",
      description: "Prompt tokens across the trace.",
      gates: [],
      sourceColumns: ["PromptTokens"],
    },
    {
      name: "CompletionTokens",
      type: "Nullable(UInt32)",
      unit: "tokens",
      description: "Completion tokens across the trace.",
      gates: [],
      sourceColumns: ["CompletionTokens"],
    },
    {
      name: "CacheReadTokens",
      type: "Nullable(UInt32)",
      unit: "tokens",
      description: "Tokens served from the provider's prompt cache.",
      gates: [],
      sourceColumns: ["CacheReadTokens"],
    },
    {
      name: "CacheWriteTokens",
      type: "Nullable(UInt32)",
      unit: "tokens",
      description: "Tokens written into the provider's prompt cache.",
      gates: [],
      sourceColumns: ["CacheWriteTokens"],
    },
    {
      name: "ReasoningTokens",
      type: "Nullable(UInt32)",
      unit: "tokens",
      description: "Tokens the model spent reasoning.",
      gates: [],
      sourceColumns: ["ReasoningTokens"],
    },
    {
      name: "HasError",
      type: "Bool",
      description: "Whether any span of the trace ended in an error status.",
      gates: [],
      sourceColumns: ["HasError"],
    },
    // `HasAnnotation` is left out here for exactly the reason it is left out of
    // `traces`: it is folded from a best-effort dual-write of the annotation
    // ids, while `annotations` reads PostgreSQL directly, and publishing both
    // would answer "how many traces were annotated" two ways with nothing in
    // the schema saying which is authoritative. The authoritative one is
    // `annotations`.
    //
    // `EarliestSpanStartMs` is left out as fold working state: migration 00061
    // split it off `OccurredAt` so `store.get()` can decode the fold's span
    // timing baseline, which is how a row gets written rather than anything
    // about the trace.
    //
    // `Attributes` is withheld: the fold's size trim
    // (`analytics-attribute-trim.service.ts`) can evict keys with nothing in
    // the row saying it happened, so a caller cannot tell an absent key from a
    // trimmed one — a silently incomplete map read as complete. `traces`
    // carries the attributes; re-add here once the trim marks what it dropped.
  ],
};

/**
 * Trace metrics per minute: the pre-aggregated fast path.
 *
 * The source rollup breaks each minute down by (Model, SpanType); this view
 * groups that breakdown away, because half its measures are trace facts
 * (TraceCount, ErrorCount, DurationSum) that a per-model split would
 * misstate. The span-fact breakdown is `model_usage_by_minute`.
 */
const TRACE_METRICS_BY_MINUTE: LangWatchQLViewDefinition = {
  name: "trace_metrics_by_minute",
  sourceTable: "trace_analytics_rollup",
  description:
    "Trace and span metrics summed per minute. Every measure is a sum: divide by TraceCount for a per-trace average.",
  gates: [],
  grain: "one row per (TenantId, BucketStart), every measure summed",
  grainColumns: ["TenantId", "BucketStart"],
  // The grain itself: the source's (Model, SpanType) breakdown is grouped away
  // in the view, so a minute join meets exactly one row. The per-model
  // breakdown lives in `model_usage_by_minute`.
  joinKeys: ["TenantId", "BucketStart"],
  timeColumn: "BucketStart",
  freshness: PROJECTION_FRESHNESS,
  dedup: {
    // The source's whole `ORDER BY` — the key the `AggregatingMergeTree`
    // merges on — which is wider than the published grain, so the view is
    // rendered as a `GROUP BY` over the grain rather than with `FINAL`.
    keyColumns: ["TenantId", "BucketStart", "Model", "SpanType"],
    aggregating: true,
  },
  columns: [
    {
      name: "TenantId",
      type: "String",
      description: "Project the bucket belongs to.",
      gates: [],
      sourceColumns: ["TenantId"],
    },
    {
      name: "BucketStart",
      type: "DateTime64(3)",
      description:
        "Start of the minute the measures cover. Filter on this to prune partitions.",
      gates: [],
      sourceColumns: ["BucketStart"],
    },
    {
      name: "SpanCount",
      type: "UInt64",
      description: "Spans recorded in the bucket.",
      gates: [],
      sourceColumns: ["SpanCount"],
      summed: true,
    },
    {
      name: "TraceCount",
      type: "UInt64",
      description:
        "Traces started in the bucket. Counts a trace once its root span arrives, so a trace with no root span contributes measures and no count.",
      gates: [],
      sourceColumns: ["TraceCount"],
      summed: true,
    },
    {
      name: "ErrorCount",
      type: "UInt64",
      description: "Traces in the bucket whose root span ended in an error status.",
      gates: [],
      sourceColumns: ["ErrorCount"],
      summed: true,
    },
    {
      name: "CostSum",
      type: "Float64",
      unit: "USD",
      description: "Total cost of the bucket's spans, in USD.",
      gates: ["costs"],
      sourceColumns: ["CostSum"],
      summed: true,
    },
    {
      name: "NonBilledCostSum",
      type: "Float64",
      unit: "USD",
      description:
        "Cost of the bucket's spans that is not billed, in USD. Billed cost is the difference from CostSum.",
      gates: ["costs"],
      sourceColumns: ["NonBilledCostSum"],
      summed: true,
    },
    {
      name: "DurationSum",
      type: "Int64",
      unit: "ms",
      description: "Total wall-clock duration of the bucket's traces, in milliseconds.",
      gates: [],
      sourceColumns: ["DurationSum"],
      summed: true,
    },
    {
      name: "PromptTokensSum",
      type: "UInt64",
      unit: "tokens",
      description: "Prompt tokens across the bucket's spans.",
      gates: [],
      sourceColumns: ["PromptTokensSum"],
      summed: true,
    },
    {
      name: "CompletionTokensSum",
      type: "UInt64",
      unit: "tokens",
      description: "Completion tokens across the bucket's spans.",
      gates: [],
      sourceColumns: ["CompletionTokensSum"],
      summed: true,
    },
    {
      name: "CacheReadTokensSum",
      type: "UInt64",
      unit: "tokens",
      description:
        "Tokens served from the provider's prompt cache across the bucket's spans.",
      gates: [],
      sourceColumns: ["CacheReadTokensSum"],
      summed: true,
    },
    {
      name: "CacheWriteTokensSum",
      type: "UInt64",
      unit: "tokens",
      description:
        "Tokens written into the provider's prompt cache across the bucket's spans.",
      gates: [],
      sourceColumns: ["CacheWriteTokensSum"],
      summed: true,
    },
    {
      name: "ReasoningTokensSum",
      type: "UInt64",
      unit: "tokens",
      description: "Reasoning tokens across the bucket's spans.",
      gates: [],
      sourceColumns: ["ReasoningTokensSum"],
      summed: true,
    },
  ],
};

/**
 * Model usage per minute: the (Model, SpanType) breakdown of the trace rollup.
 *
 * Span facts only. The rollup also carries trace facts — TraceCount,
 * ErrorCount, DurationSum — which belong to a whole trace and would be
 * misleading broken out by the model of individual spans, so they are
 * published on `trace_metrics_by_minute` and withheld here.
 */
const MODEL_USAGE_BY_MINUTE: LangWatchQLViewDefinition = {
  name: "model_usage_by_minute",
  sourceTable: "trace_analytics_rollup",
  description:
    "Span metrics summed per minute, per model and span type: span counts, costs and tokens.",
  gates: [],
  grain:
    "one merged row per (TenantId, BucketStart, Model, SpanType), every measure summed",
  // The whole bucket key: every column here is a *sum*, so a join that
  // matches less than the key meets several buckets and multiplies them —
  // a wrong number rather than a repeated row.
  joinKeys: ["TenantId", "BucketStart", "Model", "SpanType"],
  timeColumn: "BucketStart",
  freshness: PROJECTION_FRESHNESS,
  dedup: {
    // The source's whole `ORDER BY`, because that is the key the
    // `AggregatingMergeTree` merges on.
    keyColumns: ["TenantId", "BucketStart", "Model", "SpanType"],
    aggregating: true,
  },
  columns: [
    {
      name: "TenantId",
      type: "String",
      description: "Project the bucket belongs to.",
      gates: [],
      sourceColumns: ["TenantId"],
    },
    {
      name: "BucketStart",
      type: "DateTime64(3)",
      description:
        "Start of the minute the measures cover. Filter on this to prune partitions.",
      gates: [],
      sourceColumns: ["BucketStart"],
    },
    {
      name: "Model",
      type: "LowCardinality(String)",
      description: "Model the spans in this bucket used, empty when they recorded none.",
      gates: [],
      sourceColumns: ["Model"],
    },
    {
      name: "SpanType",
      type: "LowCardinality(String)",
      description: "Kind of span the bucket covers, empty when the spans recorded none.",
      gates: [],
      sourceColumns: ["SpanType"],
    },
    {
      name: "SpanCount",
      type: "UInt64",
      description: "Spans recorded in the bucket.",
      gates: [],
      sourceColumns: ["SpanCount"],
      summed: true,
    },
    {
      name: "CostSum",
      type: "Float64",
      unit: "USD",
      description: "Total cost of the bucket's spans, in USD.",
      gates: ["costs"],
      sourceColumns: ["CostSum"],
      summed: true,
    },
    {
      name: "NonBilledCostSum",
      type: "Float64",
      unit: "USD",
      description:
        "Cost of the bucket's spans that is not billed, in USD. Billed cost is the difference from CostSum.",
      gates: ["costs"],
      sourceColumns: ["NonBilledCostSum"],
      summed: true,
    },
    {
      name: "PromptTokensSum",
      type: "UInt64",
      unit: "tokens",
      description: "Prompt tokens across the bucket's spans.",
      gates: [],
      sourceColumns: ["PromptTokensSum"],
      summed: true,
    },
    {
      name: "CompletionTokensSum",
      type: "UInt64",
      unit: "tokens",
      description: "Completion tokens across the bucket's spans.",
      gates: [],
      sourceColumns: ["CompletionTokensSum"],
      summed: true,
    },
    {
      name: "CacheReadTokensSum",
      type: "UInt64",
      unit: "tokens",
      description:
        "Tokens served from the provider's prompt cache across the bucket's spans.",
      gates: [],
      sourceColumns: ["CacheReadTokensSum"],
      summed: true,
    },
    {
      name: "CacheWriteTokensSum",
      type: "UInt64",
      unit: "tokens",
      description:
        "Tokens written into the provider's prompt cache across the bucket's spans.",
      gates: [],
      sourceColumns: ["CacheWriteTokensSum"],
      summed: true,
    },
    {
      name: "ReasoningTokensSum",
      type: "UInt64",
      unit: "tokens",
      description: "Reasoning tokens across the bucket's spans.",
      gates: [],
      sourceColumns: ["ReasoningTokensSum"],
      summed: true,
    },
  ],
};

/**
 * Evaluation metrics: one row per evaluation, the analytics projection.
 *
 * The one entry in the catalog that does not take the shipped dedup strategy.
 * `evaluation_analytics` is sorted `(TenantId, OccurredAt, EvaluationId)`,
 * and the fold writes its progress watermark — `max(previous, event time)` —
 * straight into `OccurredAt`, so an evaluation that received a second lifecycle
 * event carries two sort keys. `FINAL` merges by the sort key and nothing else,
 * so it would keep both rows: not a visible duplicate, but every `count`, `sum`
 * and `avg` a caller writes over this dataset silently counting that evaluation
 * twice. The owning repository refuses `FINAL` on this table for the same
 * reason, and deduplicates the way this entry does — `max(UpdatedAt)` per
 * evaluation, whatever `OccurredAt` each version carries.
 */
const EVALUATION_METRICS: LangWatchQLViewDefinition = {
  name: "evaluation_metrics",
  sourceTable: "evaluation_analytics",
  description:
    "One row per evaluation, its latest state, time-sorted, carrying its outcome, cost and the trace dimensions it inherited.",
  gates: [],
  grain: "one row per (TenantId, EvaluationId), latest version only",
  grainColumns: ["TenantId", "EvaluationId"],
  joinKeys: ["TenantId", "TraceId"],
  timeColumn: "OccurredAt",
  freshness: PROJECTION_FRESHNESS,
  dedup: {
    strategy: "in-tuple",
    keyColumns: ["TenantId", "OccurredAt", "EvaluationId"],
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
      name: "OccurredAt",
      type: "DateTime64(3)",
      description:
        "When the evaluation reached its latest state. Filter on this to prune partitions.",
      gates: [],
      sourceColumns: ["OccurredAt"],
    },
    {
      name: "UpdatedAt",
      type: "DateTime64(3)",
      description: "When this version of the row was written.",
      gates: [],
      sourceColumns: ["UpdatedAt"],
    },
    {
      name: "TraceId",
      type: "Nullable(String)",
      description: "Trace the evaluation ran against, when it ran against one.",
      gates: [],
      sourceColumns: ["TraceId"],
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
      name: "Status",
      type: "LowCardinality(String)",
      description: "Terminal state of the run: processed, skipped, or error.",
      gates: [],
      sourceColumns: ["Status"],
    },
    {
      name: "IsGuardrail",
      type: "Bool",
      description: "Whether the evaluator ran as a guardrail.",
      gates: [],
      sourceColumns: ["IsGuardrail"],
    },
    {
      name: "Passed",
      type: "Nullable(Bool)",
      description: "Pass/fail outcome, when the evaluator produced one.",
      gates: [],
      sourceColumns: ["Passed"],
    },
    {
      name: "Score",
      type: "Nullable(Float64)",
      description: "Numeric score, when the evaluator produced one.",
      gates: [],
      sourceColumns: ["Score"],
    },
    {
      name: "Label",
      type: "Nullable(String)",
      description: "Categorical outcome, when the evaluator produced one.",
      gates: [],
      sourceColumns: ["Label"],
    },
    {
      name: "Model",
      type: "Nullable(String)",
      description: "Model the evaluator itself used, not the model under evaluation.",
      gates: [],
      sourceColumns: ["Model"],
    },
    // Lifted off the evaluated trace's own row, so they carry the meaning they
    // carry on `trace_metrics` — and, for the same reason set out there, no
    // gate in the visibility policy applies to them.
    {
      name: "UserId",
      type: "Nullable(String)",
      description: "End user of the trace the evaluation ran against.",
      gates: [],
      sourceColumns: ["UserId"],
    },
    {
      name: "ConversationId",
      type: "Nullable(String)",
      description: "Conversation the trace the evaluation ran against belongs to.",
      gates: [],
      sourceColumns: ["ConversationId"],
    },
    {
      name: "CustomerId",
      type: "Nullable(String)",
      description: "Customer account the evaluated trace was recorded for.",
      gates: [],
      sourceColumns: ["CustomerId"],
    },
    {
      name: "Origin",
      type: "Nullable(String)",
      description: "Which product surface produced the evaluated trace.",
      gates: [],
      sourceColumns: ["Origin"],
    },
    {
      name: "DurationMs",
      type: "Int64",
      unit: "ms",
      description:
        "How long the evaluation took, in milliseconds. Zero when it was reported atomically.",
      gates: [],
      sourceColumns: ["DurationMs"],
    },
    {
      name: "TotalCost",
      type: "Nullable(Float64)",
      unit: "USD",
      description: "Billed cost of running the evaluator, in USD.",
      gates: ["costs"],
      sourceColumns: ["TotalCost"],
    },
    {
      name: "NonBilledCost",
      type: "Nullable(Float64)",
      unit: "USD",
      description: "Cost of running the evaluator that is not billed, in USD.",
      gates: ["costs"],
      sourceColumns: ["NonBilledCost"],
    },
    // The evaluator's payload and its explanation (`Inputs`, `Details`,
    // `Error`, `ErrorDetails`) are not on this table at all — the analytics
    // fold never writes them. `evaluations` is where a caller permitted to see
    // captured input reads them.
    {
      name: "Attributes",
      type: "Map(String, String)",
      description:
        "Evaluation-level attributes, with every captured-content key removed.",
      gates: [],
      sourceColumns: ["Attributes"],
      expression: (source) => contentFilteredMapSql(source("Attributes")),
    },
  ],
};

/** Evaluation metrics per minute: the pre-aggregated fast path. */
const EVALUATION_METRICS_BY_MINUTE: LangWatchQLViewDefinition = {
  name: "evaluation_metrics_by_minute",
  sourceTable: "evaluation_analytics_rollup",
  description:
    "Evaluation outcomes summed per minute, per evaluator type and terminal status. Every measure is a sum: pass rate is PassCount over PassCount plus FailCount.",
  gates: [],
  grain:
    "one merged row per (TenantId, BucketStart, EvaluatorType, Status), every measure summed",
  // The whole bucket key: every column here is a *sum*, so a join that
  // matches less than the key meets several buckets and multiplies them —
  // a wrong number rather than a repeated row.
  joinKeys: ["TenantId", "BucketStart", "EvaluatorType", "Status"],
  timeColumn: "BucketStart",
  freshness: PROJECTION_FRESHNESS,
  dedup: {
    keyColumns: ["TenantId", "BucketStart", "EvaluatorType", "Status"],
    aggregating: true,
  },
  columns: [
    {
      name: "TenantId",
      type: "String",
      description: "Project the bucket belongs to.",
      gates: [],
      sourceColumns: ["TenantId"],
    },
    {
      name: "BucketStart",
      type: "DateTime64(3)",
      description:
        "Start of the minute the measures cover. Filter on this to prune partitions.",
      gates: [],
      sourceColumns: ["BucketStart"],
    },
    {
      name: "EvaluatorType",
      type: "LowCardinality(String)",
      description: "Kind of evaluator the bucket covers.",
      gates: [],
      sourceColumns: ["EvaluatorType"],
    },
    {
      name: "Status",
      type: "LowCardinality(String)",
      description: "Terminal state the bucket covers: processed, skipped, or error.",
      gates: [],
      sourceColumns: ["Status"],
    },
    {
      name: "EvalCount",
      type: "UInt64",
      description: "Evaluations that finished in the bucket.",
      gates: [],
      sourceColumns: ["EvalCount"],
      summed: true,
    },
    {
      name: "PassCount",
      type: "UInt64",
      description:
        "Evaluations in the bucket the evaluator passed. Zero for evaluators that emit only a score.",
      gates: [],
      sourceColumns: ["PassCount"],
      summed: true,
    },
    {
      name: "FailCount",
      type: "UInt64",
      description:
        "Evaluations in the bucket the evaluator failed. Zero for evaluators that emit only a score.",
      gates: [],
      sourceColumns: ["FailCount"],
      summed: true,
    },
    {
      name: "ErrorCount",
      type: "UInt64",
      description: "Evaluations in the bucket that ended in an error.",
      gates: [],
      sourceColumns: ["ErrorCount"],
      summed: true,
    },
    {
      name: "SkippedCount",
      type: "UInt64",
      description: "Evaluations in the bucket that were skipped.",
      gates: [],
      sourceColumns: ["SkippedCount"],
      summed: true,
    },
    {
      name: "ScoreSum",
      type: "Float64",
      description:
        "Scores added up across the bucket. Divide by ScoreCount for the average score.",
      gates: [],
      sourceColumns: ["ScoreSum"],
      summed: true,
    },
    {
      name: "ScoreCount",
      type: "UInt64",
      description:
        "Evaluations in the bucket that emitted a numeric score, the denominator for ScoreSum.",
      gates: [],
      sourceColumns: ["ScoreCount"],
      summed: true,
    },
    {
      name: "DurationSum",
      type: "Int64",
      unit: "ms",
      description:
        "Total wall-clock duration of the bucket's evaluations, in milliseconds.",
      gates: [],
      sourceColumns: ["DurationSum"],
      summed: true,
    },
    {
      name: "CostSum",
      type: "Float64",
      unit: "USD",
      description: "Total cost of the bucket's evaluations, in USD.",
      gates: ["costs"],
      sourceColumns: ["CostSum"],
      summed: true,
    },
    {
      name: "NonBilledCostSum",
      type: "Float64",
      unit: "USD",
      description:
        "Cost of the bucket's evaluations that is not billed, in USD. Billed cost is the difference from CostSum.",
      gates: ["costs"],
      sourceColumns: ["NonBilledCostSum"],
      summed: true,
    },
  ],
};

/**
 * The LangWatchQL schema, in the order the schema endpoint should publish it:
 * the ClickHouse-resident facts, then the PostgreSQL-resident entities and
 * dimensions that name them.
 *
 * One catalog rather than two, because residence is a property of a dataset and
 * not a property of the schema. Every consumer — the schema endpoint, the
 * validator, the diagnostics — reads this list and needs no idea which half an
 * entry came from; only the provisioning generators in `../views.ts` and
 * `../provisioning.ts` ask, and they ask the entry
 * ({@link isPostgresResident}) rather than being told.
 *
 * Generations and sessions remain unexposed: both are derivable from `spans`
 * and `traces` rather than resident anywhere of their own, so each needs a
 * derived view over tables already here, not a mapping.
 */
export const LWQL_VIEW_CATALOG: readonly LangWatchQLViewDefinition[] = [
  TRACES,
  SPANS,
  EVALUATIONS,
  SIMULATIONS,
  TRACE_METRICS,
  TRACE_METRICS_BY_MINUTE,
  MODEL_USAGE_BY_MINUTE,
  EVALUATION_METRICS,
  EVALUATION_METRICS_BY_MINUTE,
  ...LWQL_POSTGRES_CATALOG,
];

/** Looks a view up by the name a caller writes. */
export function lwqlViewByName(name: string): LangWatchQLViewDefinition | undefined {
  return LWQL_VIEW_CATALOG.find((view) => view.name === name);
}
