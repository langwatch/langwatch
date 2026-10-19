/**
 * LangWatchQL for "Can I trust my numbers?": which trace fields arrive, which costs have no
 * price, and which traffic comes from tests, staging and the like.
 */

import { bucketOf, inPeriod } from "../../templates/model/lwql-period.ts";

/** A trace field the boards lean on, and how a trace shows it carries it. */
export interface HealthField {
  readonly key: "model" | "cost" | "user" | "conversation" | "labels" | "outcome";
  readonly label: string;
  /** What to send, in the words of the SDK's trace metadata. */
  readonly send: string;
  /** The LangWatchQL view and condition a trace that carries the field meets. */
  readonly view: "trace_metrics" | "traces";
  readonly condition: string;
  /** A widget reads the field when one of its queries matches, or the catalogue lists `need`. */
  readonly readBy: RegExp;
  readonly need: string;
}

export const HEALTH_FIELDS: readonly HealthField[] = [
  {
    key: "model",
    label: "Model",
    send: "the model name on each LLM call",
    view: "trace_metrics",
    condition: "notEmpty(Models)",
    readBy: /\bModels?\b/,
    need: "model",
  },
  {
    key: "cost",
    label: "Cost",
    send: "token counts or a cost on each LLM call",
    view: "trace_metrics",
    // A trace that called no model (tools, retrieval, an evaluator) stores no cost and owes none.
    condition: "(TotalCost IS NOT NULL OR empty(Models))",
    readBy: /\b(?:TotalCost|Cost|CostSum)\b/,
    need: "cost",
  },
  {
    key: "user",
    label: "User",
    send: "a user_id in the trace metadata",
    view: "trace_metrics",
    condition: "UserId IS NOT NULL",
    readBy: /\bUserId\b/,
    need: "user",
  },
  {
    key: "conversation",
    label: "Conversation",
    send: "a thread_id in the trace metadata",
    view: "trace_metrics",
    condition: "ConversationId IS NOT NULL",
    readBy: /\bConversationId\b/,
    need: "thread",
  },
  {
    key: "labels",
    label: "Labels",
    send: "labels in the trace metadata",
    view: "trace_metrics",
    condition: "notEmpty(Labels)",
    readBy: /\bLabels\b/,
    need: "labels",
  },
  {
    key: "outcome",
    label: "Outcome",
    send: "an outcome, such as resolved, in the trace metadata",
    view: "traces",
    condition: "Attributes['metadata.outcome'] != ''",
    readBy: /metadata\.outcome/,
    need: "outcome",
  },
];

// Each field is a filter, never a column the result reads, so the completeness report does
// not swap a missing field for a setup view: showing the gap is this widget's whole job.
const branch = ({ field, view, filter }: { field: string; view: string; filter: string }) =>
  `SELECT '${field}' AS field, uniqExact(TraceId) AS traces
FROM ${view}
WHERE ${inPeriod("OccurredAt")}${filter}
LIMIT 1`;

/** Traces in the period ("all"), and how many carry each field. */
export const FIELD_COVERAGE_SQL = [
  branch({ field: "all", view: "trace_metrics", filter: "" }),
  ...HEALTH_FIELDS.map(({ key, view, condition }) =>
    branch({ field: key, view, filter: `\n  AND ${condition}` }),
  ),
].join("\nUNION ALL\n");

/**
 * Traces with a model, and those with a span whose model has no price, per bucket. Traces
 * stored before the unpriced record (7 October 2026) count as priced.
 */
export const UNPRICED_TREND_SQL = `SELECT ${bucketOf("OccurredAt")} AS bucket,
  uniqExactIf(TraceId, notEmpty(Models)) AS with_model,
  uniqExactIf(TraceId, UnpricedSpanCount > 0) AS unpriced
FROM trace_metrics
WHERE ${inPeriod("OccurredAt")}
GROUP BY bucket
ORDER BY bucket`;

/** The models with no price, by the traces that used them. */
export const UNPRICED_MODELS_SQL = `SELECT model, uniqExact(TraceId) AS traces
FROM trace_metrics
ARRAY JOIN UnpricedModels AS model
WHERE ${inPeriod("OccurredAt")}
GROUP BY model
ORDER BY traces DESC
LIMIT 5`;

/** The trace origins that are test runs, never a customer's traffic. */
export const TEST_ORIGINS = ["playground", "evaluation", "simulation"] as const;

/** Environment names that clearly are not production, compared in lower case. */
export const NON_PRODUCTION_ENVIRONMENTS = [
  "test",
  "testing",
  "staging",
  "stage",
  "dev",
  "development",
  "qa",
  "sandbox",
  "local",
] as const;

const list = (values: readonly string[]) => `[${values.map((value) => `'${value}'`).join(", ")}]`;
const ENVIRONMENTS = list(NON_PRODUCTION_ENVIRONMENTS);

/**
 * Traces and cost per noise source (owner, 2026-10-08): a test origin, else a non-production
 * environment from a span, the metadata or a label; empty is production. Cost comes from spans
 * and stays unknown, never $0, where none was sent; traces come first for the report.
 */
export const NOISE_SOURCES_SQL = `SELECT source, uniqExact(TraceId) AS traces, sum(cost) AS cost
FROM (
  SELECT s.TraceId AS TraceId, s.cost AS cost,
    multiIf(has(${list(TEST_ORIGINS)}, t.origin), t.origin,
      has(${ENVIRONMENTS}, s.environment), s.environment,
      has(${ENVIRONMENTS}, t.environment), t.environment,
      arrayFirst((label) -> has(${ENVIRONMENTS}, label), t.labels)) AS source
  FROM (
    SELECT TraceId, Attributes['langwatch.origin'] AS origin,
      lower(coalesce(nullIf(Attributes['metadata.environment'], ''),
        nullIf(Attributes['metadata.env'], ''), '')) AS environment,
      arrayMap((label) -> lower(label),
        JSONExtract(Attributes['langwatch.labels'], 'Array(String)')) AS labels
    FROM traces
    WHERE ${inPeriod("OccurredAt")}
  ) AS t
  INNER JOIN (
    SELECT TraceId, sum(Cost) AS cost,
      lower(any(coalesce(nullIf(ResourceAttributes['deployment.environment'], ''),
        nullIf(ResourceAttributes['deployment.environment.name'], '')))) AS environment
    FROM spans
    WHERE ${inPeriod("StartTime")}
    GROUP BY TraceId
  ) AS s ON s.TraceId = t.TraceId
)
GROUP BY source
ORDER BY traces DESC
LIMIT 20`;
