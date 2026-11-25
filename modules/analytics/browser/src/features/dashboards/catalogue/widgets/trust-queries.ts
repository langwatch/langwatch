/**
 * LangWatchQL for "Can I trust my numbers?": which trace fields arrive, which costs have no
 * price, and which traffic comes from tests, staging and the like.
 */

import { bucketOf, inPeriod } from "../../templates/model/lwql-period.ts";

/** A trace field the boards lean on, and the widgets that read it. */
export interface HealthField {
  readonly key: "model" | "cost" | "conversation" | "user" | "labels" | "outcome";
  readonly label: string;
  /** A widget reads the field when one of its queries matches, or the catalogue lists `need`. */
  readonly readBy: RegExp;
  readonly need: string;
}

export const HEALTH_FIELDS: readonly HealthField[] = [
  { key: "model", label: "Model name", readBy: /\bModels?\b/, need: "model" },
  { key: "cost", label: "Cost", readBy: /\b(?:TotalCost|Cost|CostSum)\b/, need: "cost" },
  {
    key: "conversation",
    label: "Conversation id",
    readBy: /\bConversationId\b/,
    need: "thread",
  },
  { key: "user", label: "User id", readBy: /\bUserId\b/, need: "user" },
  {
    key: "labels",
    label: "Customer or labels",
    readBy: /\b(?:Labels|CustomerId)\b/,
    need: "labels",
  },
  {
    key: "outcome",
    label: "How it ended",
    readBy: /metadata\.outcome|\bMetadataOutcome\b/,
    need: "outcome",
  },
];

/** A row of the coverage result: what it counts, out of which requests, and one that misses. */
interface CoverageRow {
  readonly field: string;
  readonly present: string;
  readonly base: string;
  /** The requests a missing one is picked from; absent when nothing can miss. */
  readonly missing?: string;
}

// `has_calls`: a step LangWatch types as a model call (set from gen_ai attributes when the app
// sends no type), or a model name on the request. `has_named`: the request names a model.
const COVERAGE: readonly CoverageRow[] = [
  { field: "all", present: "true", base: "true" },
  {
    field: "model",
    present: "has_calls AND has_named",
    base: "has_calls",
    missing: "has_calls AND NOT has_named",
  },
  {
    field: "cost",
    present: "has_named AND has_priced",
    base: "has_named",
    missing: "has_named AND NOT has_priced",
  },
  {
    field: "no_tokens",
    present: "has_named AND NOT has_priced AND NOT has_unpriced",
    base: "has_named",
    missing: "has_named AND NOT has_priced AND NOT has_unpriced",
  },
  {
    field: "no_price",
    present: "has_named AND has_unpriced",
    base: "has_named",
    missing: "has_named AND has_unpriced",
  },
  ...["conversation", "user", "labels", "outcome"].map((field) => ({
    field,
    present: `has_${field}`,
    base: "true",
    missing: `NOT has_${field}`,
  })),
  {
    field: "neither",
    present: "NOT has_conversation AND NOT has_user",
    base: "true",
    missing: "NOT has_conversation AND NOT has_user",
  },
];

const pick = (part: (row: CoverageRow) => string, otherwise = "0") =>
  `multiIf(${COVERAGE.map((row) => `field = '${row.field}', ${part(row)}`).join(", ")}, ${otherwise})`;

/** The per-trace flags each side of the scan writes; the other side writes 0. */
const FLAGS = ["llm", "named", "priced", "unpriced", "conversation", "user", "labels", "outcome"];
const flags = (values: Readonly<Record<string, string>>) =>
  FLAGS.map((flag) => `toUInt8(${values[flag] ?? "0"}) AS ${flag}`).join(", ");

/**
 * Each field over the requests it applies to (dashboards-v2 AC166b): one scan of each view, folded
 * per trace on its 128-bit hash (a set of ids ran out of memory over 60 days). Rows unfold from a
 * split string, as LangWatchQL allows no array literal.
 */
export const FIELD_COVERAGE_SQL = `SELECT arrayJoin(splitByChar(',', '${COVERAGE.map(({ field }) => field).join(",")}')) AS field,
  ${pick(({ field }) => (field === "all" ? "total" : `${field}_present`))} AS present,
  ${pick(({ base }) => (base === "true" ? "total" : `${base.slice(4)}_base`))} AS base,
  ${pick(({ field, missing }) => (missing ? `${field}_example` : "''"), "''")} AS example
FROM (
  SELECT count() AS total, countIf(has_calls) AS calls_base, countIf(has_named) AS named_base,
    ${COVERAGE.filter(({ field }) => field !== "all")
      .map(
        ({ field, present, missing }) =>
          `countIf(${present}) AS ${field}_present, minIf(example_id, ${missing}) AS ${field}_example`,
      )
      .join(",\n    ")}
  FROM (
    SELECT trace, min(id) AS example_id, max(llm OR named) AS has_calls,
      ${FLAGS.filter((flag) => flag !== "llm")
        .map((flag) => `max(${flag}) AS has_${flag}`)
        .join(", ")}
    FROM (
      SELECT sipHash128(TraceId) AS trace, TraceId AS id, ${flags({ llm: "1" })}, false AS isTrace
      FROM span_metrics
      WHERE SpanType = 'llm' AND ${inPeriod("StartTime")}
      UNION ALL
      SELECT sipHash128(TraceId) AS trace, TraceId AS id, ${flags({
        named: "notEmpty(Models)",
        priced: "TotalCost IS NOT NULL AND UnpricedSpanCount = 0",
        unpriced: "UnpricedSpanCount > 0",
        conversation: "ConversationId IS NOT NULL",
        user: "UserId IS NOT NULL",
        labels: "notEmpty(Labels) OR CustomerId IS NOT NULL",
        outcome: "MetadataOutcome != ''",
      })}, true AS isTrace
      FROM trace_metrics
      WHERE ${inPeriod("OccurredAt")}
    )
    GROUP BY trace
    HAVING countIf(isTrace) > 0
  )
  HAVING total > 0
)`;

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
