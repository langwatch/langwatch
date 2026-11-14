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
    view: "trace_metrics",
    condition: "MetadataOutcome != ''",
    readBy: /metadata\.outcome|\bMetadataOutcome\b/,
    need: "outcome",
  },
];

// Each field is a filter, never a column the result reads, so the completeness report does
// not swap a missing field for a setup view. One scan per view, a flag per field on each trace's
// 128-bit hash, then summed: a set of ids per field ran out of memory over 60 days. The fields
// unfold from a split string, as LangWatchQL allows no array literal. A field no trace carries
// keeps its row at 0; a period with no trace has no row.
const scan = ({ view, fields }: { view: string; fields: readonly Coverage[] }) => {
  const flagged = fields.filter(({ condition }) => condition);
  const flags = flagged
    .map(({ key, condition }) => `max(${condition}) AS has_${key}`)
    .join(",\n      ");
  const sums = flagged.map(({ key }) => `sum(has_${key}) AS has_${key}`).join(", ");
  const keys = fields.map(({ key }) => key).join(",");
  const counts = fields
    .map(({ key, condition }) => `field = '${key}', ${condition ? `has_${key}` : "total"}`)
    .join(", ");
  return `SELECT arrayJoin(splitByChar(',', '${keys}')) AS field,
  multiIf(${counts}, 0) AS traces
FROM (
  SELECT count() AS total, ${sums}
  FROM (
    SELECT sipHash128(TraceId) AS trace,
      ${flags}
    FROM ${view}
    WHERE ${inPeriod("OccurredAt")}
    GROUP BY trace
  )
  HAVING total > 0
)`;
};

interface Coverage {
  readonly key: string;
  readonly view: string;
  readonly condition?: string;
}

const COVERAGE: readonly Coverage[] = [{ key: "all", view: "trace_metrics" }, ...HEALTH_FIELDS];

/** Traces in the period ("all"), and how many carry each field. */
export const FIELD_COVERAGE_SQL = [...new Set(COVERAGE.map(({ view }) => view))]
  .map((view) => scan({ view, fields: COVERAGE.filter((field) => field.view === view) }))
  .join("\nUNION ALL\n");

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

/** A trace's test origin, kept apart from the environment positions below it. */
const ORIGIN_CODE = 16;
/** Room for a code below a row's time, so one `min` picks the first row and its code together. */
const CODE_SPAN = 32;

/** The first trace row's code, read back from below its time. */
const TRACE_CODE = `first % ${CODE_SPAN}`;

/**
 * Traces and cost per noise source (owner, 2026-10-08): a test origin, else a non-production
 * environment from a span, the metadata or a label; empty is production. Unsent cost stays
 * unknown, never $0. Spans and trace rows meet in one fixed-size group per trace (ADR-004). */
export const NOISE_SOURCES_SQL = `SELECT multiIf(
    ${TRACE_CODE} > ${ORIGIN_CODE}, arrayElement(${list(TEST_ORIGINS)}, ${TRACE_CODE} - ${ORIGIN_CODE}),
    environment > 0, arrayElement(${ENVIRONMENTS}, environment),
    arrayElement(${ENVIRONMENTS}, ${TRACE_CODE})) AS source,
  count() AS traces,
  sum(cost) AS cost
FROM (
  SELECT trace,
    sum(cost) AS cost,
    any(environment) AS environment,
    minIf(dateDiff('millisecond', toDateTime64(0, 3), at) * ${CODE_SPAN} + code, isTrace) AS first
  FROM (
    SELECT sipHash128(TraceId) AS trace, Cost AS cost,
      if(DeploymentEnvironment = '', NULL,
        toUInt8(indexOf(${ENVIRONMENTS}, lower(DeploymentEnvironment)))) AS environment,
      toUInt8(0) AS code, toDateTime64(0, 3) AS at, false AS isTrace
    FROM span_metrics
    WHERE ${inPeriod("StartTime")}
    UNION ALL
    SELECT sipHash128(TraceId) AS trace, CAST(NULL AS Nullable(Float64)) AS cost,
      CAST(NULL AS Nullable(UInt8)) AS environment,
      toUInt8(if(has(${list(TEST_ORIGINS)}, Origin), ${ORIGIN_CODE} + indexOf(${list(TEST_ORIGINS)}, Origin),
        indexOf(${ENVIRONMENTS}, if(has(${ENVIRONMENTS}, lower(MetadataEnvironment)), lower(MetadataEnvironment),
          arrayFirst((label) -> has(${ENVIRONMENTS}, label), arrayMap((label) -> lower(label), Labels)))))) AS code,
      OccurredAt AS at, true AS isTrace
    FROM trace_metrics
    WHERE ${inPeriod("OccurredAt")}
  )
  GROUP BY trace
  HAVING countIf(NOT isTrace) > 0 AND first > 0
)
GROUP BY source
ORDER BY traces DESC
LIMIT 20`;
