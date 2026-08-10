/**
 * Aggregation Builder - Builds complete ClickHouse queries for analytics.
 *
 * This module combines metric translations, filter translations, and grouping
 * into complete ClickHouse SQL queries.
 */

import { MAX_PROCESSED_SPANS } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import { snakeCase } from "../../../utils/stringCasing";
import type { FilterField } from "../../filters/types";
import { isZeroWhenAbsentSeries, type SeriesInputType } from "../registry";
import {
  buildJoinClause,
  type CHTable,
  extractReferencedEvaluationColumns,
  extractReferencedSpanColumns,
  extractReferencedTraceColumns,
  TRACE_ANALYTICS_COLUMNS,
  TRACE_IDENTITY_COLUMNS,
  tableAliases,
} from "./field-mappings";
import { translateAllFilters } from "./filter-translator";
import {
  buildMetricAlias,
  type MetricTranslation,
  nonBilledCostExpression,
  translateMetric,
  translatePipelineAggregation,
} from "./metric-translator";

/**
 * Resolve which columns a joined table needs based on the SQL expressions
 * that reference it.
 *
 * Returns a `ReadonlySet<string>` of column names to pass as
 * `requiredColumns` to `buildJoinClause`. This ensures each JOIN subquery
 * only SELECTs the columns actually used, avoiding expensive reads of
 * wide columns like SpanAttributes or Events arrays.
 */
function resolveRequiredColumns(
  table: CHTable,
  expressions: string[],
): ReadonlySet<string> | undefined {
  switch (table) {
    case "stored_spans":
      return extractReferencedSpanColumns(expressions);
    case "evaluation_runs":
      return extractReferencedEvaluationColumns(expressions);
    default:
      return undefined;
  }
}

/**
 * Date filter constants for pushing partition-pruning predicates into
 * the IN-tuple dedup subquery. Each constant matches a specific parameter
 * binding pattern used by callers of dedupedTraceSummaries.
 */
const DATE_FILTER_BOTH_PERIODS = `AND ((OccurredAt >= {currentStart:DateTime64(3)} AND OccurredAt < {currentEnd:DateTime64(3)}) OR (OccurredAt >= {previousStart:DateTime64(3)} AND OccurredAt < {previousEnd:DateTime64(3)}))`;
const DATE_FILTER_CURRENT = `AND OccurredAt >= {currentStart:DateTime64(3)} AND OccurredAt < {currentEnd:DateTime64(3)}`;
const DATE_FILTER_PREVIOUS = `AND OccurredAt >= {previousStart:DateTime64(3)} AND OccurredAt < {previousEnd:DateTime64(3)}`;
const DATE_FILTER_START_END = `AND OccurredAt >= {startDate:DateTime64(3)} AND OccurredAt < {endDate:DateTime64(3)}`;

/**
 * StartTime partition-pruning predicates for the `stored_spans` subqueries that
 * span/event facet filters generate (see translateAllFilters' spanTimePredicate
 * argument). `stored_spans` is partitioned by `toYearWeek(StartTime)` and tiered
 * to S3, so an unbounded facet subquery cold-scans every weekly partition. A
 * span's StartTime falls within its trace's lifetime, so bounding it to the same
 * date envelope the outer OccurredAt filter uses — plus a 2-day cushion for long
 * traces / clock skew, matching the span-fetch partition hints elsewhere — prunes
 * the scan without changing which traces match. One constant per caller date
 * regime: the two-period aggregation vs. the single start/end-range builders.
 */
const SPAN_TIME_FILTER_BOTH_PERIODS =
  "AND StartTime >= {previousStart:DateTime64(3)} - INTERVAL 2 DAY " +
  "AND StartTime < {currentEnd:DateTime64(3)} + INTERVAL 2 DAY";
const SPAN_TIME_FILTER_START_END =
  "AND StartTime >= {startDate:DateTime64(3)} - INTERVAL 2 DAY " +
  "AND StartTime < {endDate:DateTime64(3)} + INTERVAL 2 DAY";

// Partition-pruning bounds for the evaluation_runs JOIN subquery. The query
// windows on trace OccurredAt, but evaluation_runs is partitioned by
// ScheduledAt per the migrations (and by UpdatedAt on long-lived deployments
// that predate that DDL), so an OccurredAt filter prunes nothing there —
// without these bounds the JOIN's dedup subquery walks the tenant's entire
// history across every weekly partition, including the S3-tiered cold ones.
//
// Lower bounds only, on BOTH candidate partition columns, so pruning works on
// either partitioning scheme. Safe as a superset: an evaluation joined to an
// in-window trace is scheduled at/after that trace occurs, and every row
// version's UpdatedAt >= its ScheduledAt, so both columns are >= the window
// start minus scheduling skew — far inside the 7-day margin (partitions are
// weekly, so the margin costs at most one extra partition). No upper bound:
// a re-evaluation updates rows long after the window, and the IN-tuple dedup
// must still see that latest version.
//
// UpdatedAt is table-qualified. trace_summaries (the outer scope) also has an
// UpdatedAt column, and ClickHouse resolves a bare identifier the inner table
// lacks against the OUTER scope instead of failing — the hazard
// `join-time-bound-partition-column.unit.test.ts` guards against. Qualifying
// pins the reference to evaluation_runs' own column so neither ClickHouse nor
// the guard has to guess. ScheduledAt stays bare: it is evaluation_runs' own
// partition column per the migrations and does not exist on trace_summaries.
//
// The ScheduledAt bound is NULL-safe. On the unified schema (00002) the column
// is `DateTime64(3) DEFAULT now64(3)` and the IS NULL branch is statically
// false, so partition pruning is unaffected. But long-lived deployments that
// predate the unified DDL carry `ScheduledAt Nullable(DateTime64(3))`, where a
// bare `ScheduledAt >= x` evaluates to NULL for NULL rows and silently DROPS
// those evaluations from every graph — a correctness regression, not a missed
// optimisation. NULL rows on such deployments are still bounded by the
// UpdatedAt predicate, which is their actual partition column anyway.
const EVAL_TIME_FILTER_BOTH_PERIODS =
  "AND (ScheduledAt IS NULL OR ScheduledAt >= {previousStart:DateTime64(3)} - INTERVAL 7 DAY) " +
  "AND evaluation_runs.UpdatedAt >= {previousStart:DateTime64(3)} - INTERVAL 7 DAY";
const EVAL_TIME_FILTER_START_END =
  "AND (ScheduledAt IS NULL OR ScheduledAt >= {startDate:DateTime64(3)} - INTERVAL 7 DAY) " +
  "AND evaluation_runs.UpdatedAt >= {startDate:DateTime64(3)} - INTERVAL 7 DAY";

/**
 * Returns a deduped FROM-clause expression for trace_summaries.
 *
 * trace_summaries uses ReplacingMergeTree(UpdatedAt) which can return
 * multiple versions of the same trace between merges. This wraps the table
 * in a subquery that uses the IN-tuple dedup pattern: a lightweight inner
 * GROUP BY resolves the latest version per TraceId using only key columns,
 * then the outer query reads the full column set only for matched rows.
 *
 * The TenantId filter is pushed into both the outer and inner subqueries
 * so ClickHouse can prune data early. When a dateFilter is provided, it is
 * also pushed into both subqueries to enable partition pruning on
 * toYearWeek(OccurredAt).
 *
 * @param alias - Table alias (e.g., "ts")
 * @param columns - Optional explicit column list. When omitted, selects all
 *   analytics columns (still excludes ComputedInput/ComputedOutput).
 * @param dateFilter - Optional SQL fragment for date range filtering
 *   (e.g., DATE_FILTER_CURRENT). Pushed into both outer and inner subqueries
 *   for partition pruning.
 *
 * @see dev/docs/best_practices/clickhouse-queries.md — "Safe Pattern: IN-Tuple Dedup"
 */
function dedupedTraceSummaries(
  alias: string,
  columns?: readonly string[],
  dateFilter?: string,
): string {
  const columnList = columns
    ? Array.from(columns).join(", ")
    : TRACE_ANALYTICS_COLUMNS.join(", ");
  const dateClause = dateFilter ?? "";
  return `(
    SELECT ${columnList} FROM trace_summaries
    WHERE TenantId = {tenantId:String}
      ${dateClause}
      AND (TenantId, TraceId, UpdatedAt) IN (
        SELECT TenantId, TraceId, max(UpdatedAt)
        FROM trace_summaries
        WHERE TenantId = {tenantId:String}
          ${dateClause}
        GROUP BY TenantId, TraceId
      )
  ) ${alias}`;
}

/**
 * The trace_summaries columns a metric/timeseries query actually references.
 *
 * The deduped trace subquery used to SELECT the full {@link TRACE_ANALYTICS_COLUMNS}
 * set — including the wide `Attributes` map — for every trace in range before
 * aggregating, which drove analytics scans into the per-query memory limit on
 * large tenants (observed: a metadata-cardinality summary reading ~10 GiB).
 * Threading the referenced columns into {@link dedupedTraceSummaries} lets
 * ClickHouse read only what the query uses: the identity columns (always needed
 * for dedup / tenant / time) plus whatever the metric expressions, group-by
 * column, filter and JOIN clauses touch.
 *
 * The result is always a subset of {@link TRACE_ANALYTICS_COLUMNS} (what the
 * subquery read before), so it can never expose a column the query couldn't
 * already use. When in doubt it over-includes (a column referenced by any of
 * the passed expressions is kept), so it never under-selects and breaks a query.
 */
function referencedTraceColumns(
  metrics: MetricTranslation[],
  extraExpressions: string[],
): readonly string[] {
  const metricExpressions = metrics.flatMap((metric) => {
    const exprs = [metric.selectExpression];
    const subquery = metric.subquery;
    if (subquery) {
      exprs.push(
        subquery.innerSelect,
        subquery.innerGroupBy,
        subquery.outerAggregation,
      );
      if (subquery.nestedSubquery) {
        exprs.push(
          subquery.nestedSubquery.select,
          subquery.nestedSubquery.groupBy,
          subquery.nestedSubquery.having ?? "",
        );
      }
    }
    return exprs;
  });
  return [
    ...TRACE_IDENTITY_COLUMNS,
    ...extractReferencedTraceColumns([
      ...metricExpressions,
      ...extraExpressions,
    ]),
  ];
}

/** Maximum number of filter options returned by filter queries */
const MAX_FILTER_OPTIONS = 10000;

/**
 * Time interval constants for date truncation decisions.
 * WHY: These thresholds determine the optimal date grouping granularity
 * based on the query time range. Too fine granularity creates too many buckets,
 * too coarse loses detail.
 */
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR; // 1440
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 31; // Approximate, triggers month-level grouping

/**
 * Validate timezone string against IANA timezone database.
 * Falls back to UTC if invalid to prevent SQL injection.
 */
function validateTimeZone(timeZone: string): string {
  try {
    // Use Intl.DateTimeFormat to validate - it throws for invalid timezones
    Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/**
 * Quote an identifier with backticks if it starts with a digit.
 * ClickHouse requires backticks for identifiers starting with numbers.
 */
function quoteIdentifier(identifier: string): string {
  if (/^\d/.test(identifier)) {
    return `\`${identifier}\``;
  }
  return identifier;
}

/**
 * Date grouping options
 */
export type DateGrouping =
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "year"
  | "full";

/**
 * GroupBy field options
 */
export type GroupByField =
  | "metadata.user_id"
  | "metadata.thread_id"
  | "metadata.customer_id"
  | "metadata.labels"
  | "metadata.model"
  | "metadata.span_type"
  | "topics.topics"
  | "traces.trace_name"
  | "evaluations.evaluation_passed"
  | "evaluations.evaluation_label"
  | "evaluations.evaluation_processing_state"
  | "events.event_type"
  | "sentiment.thumbs_up_down"
  | "error.has_error";

/**
 * Result of resolving a groupBy field expression
 */
interface GroupByExpression {
  column: string;
  requiredJoins: CHTable[];
  usesArrayJoin?: boolean;
  handlesUnknown?: boolean;
  /**
   * Model grouping attributes additive metrics (cost, tokens) per SPAN via the
   * span-model partition join (see buildSpanModelPartitionJoin), so per-model
   * buckets sum exactly to the ungrouped totals instead of counting each
   * multi-model trace once per model it touched.
   */
  spanModelPartitioned?: boolean;
}

/**
 * Alias for the span-model partition subquery joined by model group-bys.
 * Distinct from `ss` (the generic stored_spans JOIN used by filters/metrics)
 * so both can coexist in one query.
 */
const SPAN_MODEL_ALIAS = "smd";

/**
 * A span's model bucket: response model > request model > 'unknown'.
 * Mirrors SpanCostService.extractModelsFromSpan (which the fold and the
 * ADR-034 rollup use), so a span's bucket matches the model its cost was
 * attributed to at fold time.
 */
const SPAN_MODEL_KEY_EXPR = `multiIf(SpanAttributes['gen_ai.response.model'] != '', SpanAttributes['gen_ai.response.model'], SpanAttributes['gen_ai.request.model'] != '', SpanAttributes['gen_ai.request.model'], 'unknown')`;

/**
 * Redundant-usage gate: mirrors SpanCostService.isTokenAccumulationSkipped.
 * A span marked as a duplicate usage copy (e.g. codex's lower-level response
 * span echoing the turn rollup) contributed nothing to the trace totals, so
 * it must contribute nothing to the per-model buckets either, otherwise the
 * bucket sum overshoots the ungrouped total.
 */
const SPAN_NOT_SKIPPED = `SpanAttributes['langwatch.reserved.skip_token_accumulation'] != 'true'`;

/**
 * Span token read mirroring SpanCostService.extractTokenMetrics:
 * `Math.max(0, coerceToNumber(value) ?? 0)`.
 */
function spanTokenReadExpr(attrKey: string): string {
  return `greatest(coalesce(toFloat64OrNull(SpanAttributes['${attrKey}']), 0), 0)`;
}

/**
 * Span cache/reasoning token read mirroring SpanCostService.extractCacheTokens:
 * the first strictly-positive value among the candidate keys, else 0.
 */
function spanFirstPositiveExpr(attrKeys: string[]): string {
  const branches = attrKeys
    .map(
      (key) =>
        `coalesce(toFloat64OrNull(SpanAttributes['${key}']), 0) > 0, toFloat64OrNull(SpanAttributes['${key}'])`,
    )
    .join(", ");
  return `multiIf(${branches}, 0)`;
}

/**
 * Build the LEFT JOIN that partitions a trace's additive metrics across the
 * models its spans actually used: one joined row per (trace, span model).
 *
 * Two aggregation levels:
 *   1. Per (trace, span, model): `max()` per contribution collapses the rare
 *      duplicate stored_spans rows a redelivered SpanReceivedEvent leaves
 *      before the ReplacingMergeTree merge, without the banned `LIMIT 1 BY`
 *      pattern (see aggregation-builder-dedup-safety.unit.test.ts).
 *   2. Per (trace, model): `sum()` of the span contributions: the bucket's
 *      share of the trace totals.
 *
 * `Cost`/`NonBilledCost` are the fold-parity per-span columns (migration
 * 00037, computed by the same SpanCostService as the trace totals). Rows
 * stored before that migration carry NULL cost, so grouped COST attribution
 * degrades to 0 for that history while token attribution (read from
 * SpanAttributes, which always existed) stays exact.
 *
 * The HAVING keeps `'unknown'` rows only when they carry a real contribution:
 * a trace whose model-less spans contributed nothing must NOT mint a spurious
 * `unknown` bucket. A trace with NO surviving rows at all (log-only, genuinely
 * model-less, or nothing but zero-contribution model-less spans) falls back to
 * trace-level attribution in the group-by expression and the CTE columns.
 */
function buildSpanModelPartitionJoin(spanTimeFilter: string): string {
  const ts = tableAliases.trace_summaries;
  const smd = SPAN_MODEL_ALIAS;
  const contribution = (expr: string) =>
    `max(if(${SPAN_NOT_SKIPPED}, ${expr}, 0))`;
  // TraceSpanCount = spans of the trace visible to THIS scan, computed as a
  // window over the per-bucket groups BEFORE the zero-suppression filter (a
  // suppressed model-less bucket still holds real spans, e.g. the root).
  // spanModelPartitionMissExpr compares it against ts.SpanCount to detect an
  // incomplete scan (spans outside the StartTime envelope) and fall back to
  // whole-trace attribution instead of shipping a partial partition.
  return `LEFT JOIN (
        SELECT *
        FROM (
          SELECT
            TenantId,
            TraceId,
            SpanModelKey,
            sum(SpanCost) AS SpanModelCost,
            sum(SpanNonBilledCost) AS SpanModelNonBilledCost,
            sum(SpanPromptTokens) AS SpanModelPromptTokens,
            sum(SpanCompletionTokens) AS SpanModelCompletionTokens,
            sum(SpanCacheReadTokens) AS SpanModelCacheReadTokens,
            sum(SpanCacheWriteTokens) AS SpanModelCacheWriteTokens,
            sum(SpanReasoningTokens) AS SpanModelReasoningTokens,
            sum(count()) OVER (PARTITION BY TenantId, TraceId) AS TraceSpanCount
          FROM (
            SELECT
              TenantId,
              TraceId,
              SpanId,
              ${SPAN_MODEL_KEY_EXPR} AS SpanModelKey,
              ${contribution("coalesce(Cost, 0)")} AS SpanCost,
              ${contribution("coalesce(NonBilledCost, 0)")} AS SpanNonBilledCost,
              ${contribution(spanTokenReadExpr("gen_ai.usage.input_tokens"))} AS SpanPromptTokens,
              ${contribution(spanTokenReadExpr("gen_ai.usage.output_tokens"))} AS SpanCompletionTokens,
              ${contribution(spanFirstPositiveExpr(["gen_ai.usage.cache_read.input_tokens", "gen_ai.usage.cached_tokens"]))} AS SpanCacheReadTokens,
              ${contribution(spanFirstPositiveExpr(["gen_ai.usage.cache_creation.input_tokens"]))} AS SpanCacheWriteTokens,
              ${contribution(spanFirstPositiveExpr(["gen_ai.usage.reasoning_tokens"]))} AS SpanReasoningTokens
            FROM stored_spans
            WHERE TenantId = {tenantId:String} ${spanTimeFilter}
            GROUP BY TenantId, TraceId, SpanId, SpanModelKey
          )
          GROUP BY TenantId, TraceId, SpanModelKey
        )
        WHERE SpanModelKey != 'unknown'
          OR SpanModelCost > 0
          OR SpanModelNonBilledCost > 0
          OR SpanModelPromptTokens > 0
          OR SpanModelCompletionTokens > 0
          OR SpanModelCacheReadTokens > 0
          OR SpanModelCacheWriteTokens > 0
          OR SpanModelReasoningTokens > 0
      ) ${smd} ON ${ts}.TenantId = ${smd}.TenantId AND ${ts}.TraceId = ${smd}.TraceId`;
}

/**
 * Condition under which a model-grouped trace falls back to WHOLE-TRACE
 * attribution under its primary model (`Models[1]`, or `'unknown'`), keeping
 * every trace an exact single-bucket partition instead of a wrong multi-bucket
 * one. True when:
 *
 *   - the span-model join found nothing (log-only traces, spans not stored);
 *   - the trace is past the fold's MAX_PROCESSED_SPANS cap: the fold FREEZES
 *     cost/token totals at the cap while stored_spans keeps every span, so
 *     span-level sums would EXCEED the frozen ungrouped totals;
 *   - the scan saw fewer spans than the fold counted (ts.SpanCount): spans
 *     outside the StartTime envelope (long-lived traces, clock skew) would
 *     otherwise produce a PARTIAL partition that silently drops their share.
 *     The fold does not count synthetic spans while stored_spans keeps them,
 *     so the scan count can only ever be >= the fold count on a complete scan.
 */
function spanModelPartitionMissExpr(): string {
  const ts = tableAliases.trace_summaries;
  const smd = SPAN_MODEL_ALIAS;
  return `(${smd}.SpanModelKey IS NULL OR ${smd}.SpanModelKey = '' OR ${ts}.SpanCount > ${MAX_PROCESSED_SPANS} OR ${smd}.TraceSpanCount < ${ts}.SpanCount)`;
}

/**
 * Registry of groupBy expression builders by field type.
 *
 * WHY REGISTRY PATTERN: Different groupBy fields require different SQL expressions
 * and may need JOINs to different tables. Some use arrayJoin for multi-valued fields.
 * The registry pattern centralizes this complexity and makes it easy to add new
 * groupBy options without modifying the main query builder.
 *
 * @param groupByKey - Optional key to filter results (e.g., specific evaluator ID)
 */
const groupByExpressions: Partial<
  Record<string, (groupByKey?: string) => GroupByExpression>
> = {
  "topics.topics": () => ({
    column: `${tableAliases.trace_summaries}.TopicId`,
    requiredJoins: [],
  }),

  "traces.trace_name": () => ({
    column: `if(${tableAliases.trace_summaries}.TraceName = '', 'unknown', ${tableAliases.trace_summaries}.TraceName)`,
    requiredJoins: [],
    handlesUnknown: true,
  }),

  "metadata.user_id": () => ({
    column: `${tableAliases.trace_summaries}.Attributes['langwatch.user_id']`,
    requiredJoins: [],
  }),

  "metadata.thread_id": () => ({
    column: `${tableAliases.trace_summaries}.Attributes['gen_ai.conversation.id']`,
    requiredJoins: [],
  }),

  "metadata.customer_id": () => ({
    column: `${tableAliases.trace_summaries}.Attributes['langwatch.customer_id']`,
    requiredJoins: [],
  }),

  "metadata.labels": () => ({
    column: `arrayJoin(JSONExtract(${tableAliases.trace_summaries}.Attributes['langwatch.labels'], 'Array(String)'))`,
    requiredJoins: [],
    usesArrayJoin: true,
  }),

  // Per-SPAN attribution via the span-model partition join (LEFT JOIN `smd`,
  // one row per (trace, span model)). The former `arrayJoin(Models)` over
  // trace-level totals attributed each trace's WHOLE cost/token totals to
  // EVERY model the trace touched, so multi-model traces multiplied their
  // cost by the number of models used (~2.9x observed on a real multi-agent
  // session). Buckets come from each span's own model (response > request,
  // mirroring SpanCostService.extractModelsFromSpan); traces with no
  // span-model rows (log-only traces, or spans outside the scan window) fall
  // back to their primary model `Models[1]`, or `'unknown'` when the trace
  // genuinely has no model, so they keep a single, exactly-partitioned
  // bucket instead of vanishing.
  "metadata.model": () => ({
    column: `if(${spanModelPartitionMissExpr()}, if(empty(${tableAliases.trace_summaries}.Models), 'unknown', ${tableAliases.trace_summaries}.Models[1]), ${SPAN_MODEL_ALIAS}.SpanModelKey)`,
    requiredJoins: [],
    handlesUnknown: true,
    spanModelPartitioned: true,
  }),

  "metadata.span_type": () => ({
    column: `if(
      ${tableAliases.stored_spans}.SpanAttributes['langwatch.span.type'] = '' OR
      ${tableAliases.stored_spans}.SpanAttributes['langwatch.span.type'] IS NULL,
      'unknown',
      ${tableAliases.stored_spans}.SpanAttributes['langwatch.span.type']
    )`,
    requiredJoins: ["stored_spans"],
    handlesUnknown: true,
  }),

  "evaluations.evaluation_passed": (groupByKey) => ({
    // Score-only evaluators (issue #2674): when filtered to a specific evaluator via
    // groupByKey, rows that ran successfully (Status='processed') but have Passed IS NULL
    // (a numeric score, no pass/fail threshold) are bucketed as 'unknown' instead of being
    // dropped by `HAVING group_key IS NOT NULL`. Foreign-evaluator rows still hit ELSE NULL.
    column: groupByKey
      ? `CASE
        WHEN ${tableAliases.evaluation_runs}.EvaluatorId = {groupByKey:String} AND ${tableAliases.evaluation_runs}.Status = 'processed' AND ${tableAliases.evaluation_runs}.Passed IS NOT NULL AND ${tableAliases.evaluation_runs}.Passed = 1 THEN 'passed'
        WHEN ${tableAliases.evaluation_runs}.EvaluatorId = {groupByKey:String} AND ${tableAliases.evaluation_runs}.Status = 'processed' AND ${tableAliases.evaluation_runs}.Passed IS NOT NULL AND ${tableAliases.evaluation_runs}.Passed = 0 THEN 'failed'
        WHEN ${tableAliases.evaluation_runs}.EvaluatorId = {groupByKey:String} AND ${tableAliases.evaluation_runs}.Status = 'processed' AND ${tableAliases.evaluation_runs}.Passed IS NULL THEN 'unknown'
        ELSE NULL
      END`
      : `CASE
      WHEN ${tableAliases.evaluation_runs}.Passed = 1 THEN 'passed'
      WHEN ${tableAliases.evaluation_runs}.Passed = 0 THEN 'failed'
      ELSE 'unknown'
    END`,
    requiredJoins: ["evaluation_runs"],
    handlesUnknown: true,
  }),

  "evaluations.evaluation_label": (groupByKey) => ({
    column: groupByKey
      ? `if(${tableAliases.evaluation_runs}.EvaluatorId = {groupByKey:String} AND ${tableAliases.evaluation_runs}.Status = 'processed', ${tableAliases.evaluation_runs}.Label, '')`
      : `${tableAliases.evaluation_runs}.Label`,
    requiredJoins: ["evaluation_runs"],
  }),

  "evaluations.evaluation_processing_state": () => ({
    column: `${tableAliases.evaluation_runs}.Status`,
    requiredJoins: ["evaluation_runs"],
  }),

  "events.event_type": () => ({
    column: `arrayJoin(${tableAliases.stored_spans}."Events.Name")`,
    requiredJoins: ["stored_spans"],
    usesArrayJoin: true,
  }),

  "sentiment.thumbs_up_down": () => ({
    // Extract the vote value from Events.Attributes where event name is 'thumbs_up_down'
    // and convert to 'thumbs_up' (vote=1) or 'thumbs_down' (vote=-1)
    // Events.Name and Events.Attributes are parallel arrays, so we zip them to filter
    column: `arrayJoin(
      arrayMap(
        a -> multiIf(
          toInt32OrNull(a['event.metrics.vote']) = 1, 'Thumbs Up',
          toInt32OrNull(a['event.metrics.vote']) = -1, 'Thumbs Down',
          ''
        ),
        arrayFilter(
          (a, n) -> n = 'thumbs_up_down' AND mapContains(a, 'event.metrics.vote'),
          ${tableAliases.stored_spans}."Events.Attributes",
          ${tableAliases.stored_spans}."Events.Name"
        )
      )
    )`,
    requiredJoins: ["stored_spans"] as CHTable[],
    usesArrayJoin: true,
  }),

  "error.has_error": () => ({
    column: `if(${tableAliases.stored_spans}.StatusCode = 2, 'with error', 'without error')`,
    requiredJoins: ["stored_spans"],
  }),
};

/**
 * Query input for building a timeseries query
 */
export interface TimeseriesQueryInput {
  projectId: string;
  startDate: Date;
  endDate: Date;
  previousPeriodStartDate: Date;
  series: SeriesInputType[];
  filters?: Partial<
    Record<
      FilterField,
      | string[]
      | Record<string, string[]>
      | Record<string, Record<string, string[]>>
    >
  >;
  groupBy?: string;
  groupByKey?: string;
  timeScale?: number | "full";
  timeZone?: string;
  /** Restrict the query to these trace IDs (parameterized IN clause). */
  traceIds?: string[];
  /** Invert the filter conditions (NOT wrap), matching the UI's negate toggle. */
  negateFilters?: boolean;
}

/**
 * Built query result
 */
export interface BuiltQuery {
  sql: string;
  params: Record<string, unknown>;
}

/**
 * Build the HAVING clause for group_key filtering.
 *
 * Different groupBy fields produce different sentinel values for non-matching rows:
 * - evaluation_label with groupByKey: returns '' → filter with != ''
 * - evaluation_passed with groupByKey: returns NULL → filter with IS NOT NULL
 * - Fields with handlesUnknown=true: already handle empty/null internally → no HAVING
 * - No groupBy: no HAVING needed
 */
function buildGroupKeyHavingClause({
  groupByColumn,
  groupByHandlesUnknown,
  groupBy,
  groupByKey,
}: {
  groupByColumn: string | null;
  groupByHandlesUnknown: boolean;
  groupBy?: string;
  groupByKey?: string;
}): string {
  if (!groupByColumn) return "";
  const hasGroupByKey = !!groupByKey;
  const isEvaluationPassed = groupBy === "evaluations.evaluation_passed";
  if (isEvaluationPassed && hasGroupByKey)
    return "HAVING group_key IS NOT NULL";
  if (!groupByHandlesUnknown && !isEvaluationPassed)
    return "HAVING group_key != ''";
  return "";
}

/**
 * Get the ClickHouse date truncation function for a time scale.
 *
 * WHY: Different time ranges require different grouping granularities.
 * Short ranges (hours) need minute-level precision for detail.
 * Medium ranges (days) use hourly buckets to avoid too many data points.
 * Long ranges (weeks/months) use day/week/month buckets for performance.
 */
function getDateTruncFunction(
  timeScaleMinutes: number,
  timeZone: string,
): string {
  // Validate timezone to prevent SQL injection
  const validatedTimeZone = validateTimeZone(timeZone);

  // Convert minutes to appropriate interval
  if (timeScaleMinutes <= 1) {
    return `toStartOfMinute(ts.OccurredAt, '${validatedTimeZone}')`;
  } else if (timeScaleMinutes < MINUTES_PER_DAY) {
    // Use HOUR interval only when timeScaleMinutes is an exact multiple of 60
    // Otherwise use MINUTE interval to preserve precision (e.g., 90 minutes)
    if (timeScaleMinutes % MINUTES_PER_HOUR === 0) {
      const hours = timeScaleMinutes / MINUTES_PER_HOUR;
      return `toStartOfInterval(ts.OccurredAt, INTERVAL ${hours} HOUR, '${validatedTimeZone}')`;
    }
    return `toStartOfInterval(ts.OccurredAt, INTERVAL ${timeScaleMinutes} MINUTE, '${validatedTimeZone}')`;
  } else {
    // Days
    const days = Math.floor(timeScaleMinutes / MINUTES_PER_DAY);
    if (days === 1) {
      return `toStartOfDay(ts.OccurredAt, '${validatedTimeZone}')`;
    } else if (days <= DAYS_PER_WEEK) {
      return `toStartOfInterval(ts.OccurredAt, INTERVAL ${days} DAY, '${validatedTimeZone}')`;
    } else if (days <= DAYS_PER_MONTH) {
      return `toStartOfWeek(ts.OccurredAt, 1, '${validatedTimeZone}')`;
    } else {
      return `toStartOfMonth(ts.OccurredAt, '${validatedTimeZone}')`;
    }
  }
}

/**
 * Default fallback groupBy expression (by TraceId)
 */
const defaultGroupByExpression: GroupByExpression = {
  column: `${tableAliases.trace_summaries}.TraceId`,
  requiredJoins: [],
};

/**
 * Get the groupBy column expression for a group field.
 *
 * Uses registry lookup instead of switch statement for better extensibility.
 * When adding new groupBy fields, simply add an entry to groupByExpressions.
 *
 * @param groupBy - The field to group by
 * @param groupByKey - Optional key to filter results (e.g., specific evaluator ID)
 */
function getGroupByExpression(
  groupBy: string,
  groupByKey?: string,
): GroupByExpression {
  const builder = groupByExpressions[groupBy];
  return builder ? builder(groupByKey) : defaultGroupByExpression;
}

/**
 * Build the complete timeseries query.
 *
 * WHY SINGLE QUERY FOR BOTH PERIODS: Instead of running separate queries for
 * current and previous periods, we include both in a single query using a
 * CASE expression to tag rows by period. This halves the number of ClickHouse
 * round trips and allows the database to optimize the scan across both date ranges.
 */
export function buildTimeseriesQuery(input: TimeseriesQueryInput): BuiltQuery {
  // ADR-034 Phase 3: routing to `trace_analytics_rollup` /
  // `trace_analytics` lives in `~/server/app-layer/analytics` now — the
  // service there decides which destination to use and calls the dedicated
  // builders directly. This function only emits the legacy
  // `trace_summaries` SQL (the safe fallback).
  const ts = tableAliases.trace_summaries;
  const timeZone = input.timeZone ?? "UTC";

  // Collect all required JOINs and metric expressions
  const allJoins = new Set<CHTable>();
  const metricTranslations: MetricTranslation[] = [];

  // Translate each series metric
  for (let i = 0; i < input.series.length; i++) {
    const series = input.series[i]!;
    let translation: MetricTranslation;

    if (series.pipeline) {
      translation = translatePipelineAggregation(
        series.metric,
        series.aggregation,
        series.pipeline.field,
        series.pipeline.aggregation,
        i,
        series.key,
        series.subkey,
      );
    } else {
      translation = translateMetric(
        series.metric,
        series.aggregation,
        i,
        series.key,
        series.subkey,
      );
    }

    metricTranslations.push(translation);
    for (const join of translation.requiredJoins) {
      allJoins.add(join);
    }
  }

  // Translate filters. Span/event facet filters resolve to stored_spans
  // subqueries; pass the StartTime envelope so they prune partitions instead of
  // cold-scanning S3 (see SPAN_TIME_FILTER_BOTH_PERIODS).
  const filterTranslation = translateAllFilters(
    input.filters ?? {},
    SPAN_TIME_FILTER_BOTH_PERIODS,
  );
  for (const join of filterTranslation.requiredJoins) {
    allJoins.add(join);
  }

  // Collect all params from metric translations and filter translations
  const metricParams = metricTranslations.reduce(
    (acc, m) => ({ ...acc, ...m.params }),
    {} as Record<string, unknown>,
  );
  const allTranslationParams = {
    ...filterTranslation.params,
    ...metricParams,
  };

  // Handle groupBy
  let groupByColumn: string | null = null;
  let usesArrayJoin = false;
  let groupByHandlesUnknown = false;
  let groupByRequiresSpans = false;
  let spanModelPartitioned = false;
  if (input.groupBy) {
    const groupByExpr = getGroupByExpression(input.groupBy, input.groupByKey);
    groupByColumn = groupByExpr.column;
    usesArrayJoin = groupByExpr.usesArrayJoin ?? false;
    groupByHandlesUnknown = groupByExpr.handlesUnknown ?? false;
    groupByRequiresSpans = groupByExpr.requiredJoins.includes("stored_spans");
    spanModelPartitioned = groupByExpr.spanModelPartitioned ?? false;
    for (const join of groupByExpr.requiredJoins) {
      allJoins.add(join);
    }
  }

  // Build JOIN clauses with column pruning.
  // Collect all SQL expressions that reference columns from joined tables
  // so we only SELECT the columns actually needed in each JOIN subquery.
  const allExpressions = [
    ...metricTranslations.map((m) => m.selectExpression),
    filterTranslation.whereClause,
    groupByColumn ?? "",
  ];
  const joinClauses = Array.from(allJoins)
    .map((table) => {
      const requiredColumns = resolveRequiredColumns(table, allExpressions);
      // Both-periods regime: bound the stored_spans / evaluation_runs JOINs to
      // the same date envelope as the outer OccurredAt filter so they prune
      // partitions.
      return buildJoinClause({
        table,
        requiredColumns,
        spanTimeFilter: SPAN_TIME_FILTER_BOTH_PERIODS,
        evalTimeFilter: EVAL_TIME_FILTER_BOTH_PERIODS,
      });
    })
    .join("\n");

  // Build WHERE clause
  const baseWhere = `
    ${ts}.TenantId = {tenantId:String}
    AND (
      (${ts}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)})
      OR
      (${ts}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)})
    )
  `;

  // Assemble the filter conditions appended to every builder path's WHERE.
  // negateFilters inverts the user's filter selection (NOT wrap), matching the
  // UI's negate toggle. traceIds narrows the scan to an explicit trace set —
  // it is a scope restriction, so it is never negated.
  const filterConditions: string[] = [];
  if (filterTranslation.whereClause !== "1=1") {
    filterConditions.push(
      input.negateFilters
        ? `NOT (${filterTranslation.whereClause})`
        : filterTranslation.whereClause,
    );
  }
  if (input.traceIds && input.traceIds.length > 0) {
    filterConditions.push(`${ts}.TraceId IN ({traceIds:Array(String)})`);
    allTranslationParams.traceIds = input.traceIds;
  }
  const filterWhere =
    filterConditions.length > 0 ? `AND ${filterConditions.join(" AND ")}` : "";

  // When using arrayJoin for grouping (like labels), span-level groupBy (like
  // span_type), or the span-partitioned model grouping, we need a CTE approach
  // to avoid trace duplication affecting counts. The CTE deduplicates
  // (TraceId, group_key) pairs and preserves metrics per trace for accurate aggregation.
  // Without this, joining stored_spans causes each trace to be counted once per span.
  if (
    (usesArrayJoin || groupByRequiresSpans || spanModelPartitioned) &&
    groupByColumn
  ) {
    return buildArrayJoinTimeseriesQuery({
      input,
      groupByColumn,
      groupByHandlesUnknown,
      metricTranslations,
      joinClauses,
      baseWhere,
      filterWhere,
      filterParams: allTranslationParams,
      timeZone,
      spanModelPartitioned,
    });
  }

  // Separate simple and subquery metrics
  const simpleMetrics = metricTranslations.filter((m) => !m.requiresSubquery);
  const subqueryMetrics = metricTranslations.filter((m) => m.requiresSubquery);

  // @regression issue #3088: when trace-level metrics (e.g. sum(ts.TotalCost))
  // are mixed with evaluation metrics in the same query, the evaluation_runs
  // JOIN fans out each trace into N rows (one per evaluation run on that trace).
  // Aggregating trace-level columns over the fanned-out rows inflates them by N.
  //
  // Fix: wrap the scan in a per-trace CTE that pre-aggregates evaluation metrics
  // at trace granularity. The outer query then aggregates trace-level columns
  // without duplication and re-aggregates the per-trace eval values across traces.
  //
  // This check MUST run before the `timeScale === "full"` branch below —
  // otherwise summary widgets (timeScale: "full") mixing eval + trace metrics
  // would route through buildSubqueryTimeseriesQuery which still joins
  // evaluation_runs directly and reproduces the fan-out bug.
  //
  // Guard: only fire when there are NO pipeline (subquery) metrics. Pipeline
  // metrics live in `subqueryMetrics` which `buildMixedEvalTimeseriesQuery`
  // does not receive — routing here would silently drop them.
  if (
    subqueryMetrics.length === 0 &&
    hasEvalMixedWithTraceMetrics(simpleMetrics)
  ) {
    return buildMixedEvalTimeseriesQuery({
      input,
      ts,
      simpleMetrics,
      groupByColumn,
      groupByHandlesUnknown,
      joinClauses,
      baseWhere,
      filterWhere,
      allTranslationParams,
      timeZone,
    });
  }

  // For timeScale "full" (summary queries) without groupBy, use CTE-based query to ensure
  // both current and previous periods return data (even if one is empty).
  // When groupBy is present, fall through to the standard query path which correctly
  // handles GROUP BY group_key — the CTE path doesn't support grouped results.
  if (input.timeScale === "full" && !groupByColumn) {
    return buildSubqueryTimeseriesQuery(
      input,
      simpleMetrics,
      subqueryMetrics,
      joinClauses,
      baseWhere,
      filterWhere,
      allTranslationParams,
      groupByColumn,
      groupByHandlesUnknown,
    );
  }

  // Pipeline metrics with numeric timeScale: use date-bucketed two-level aggregation
  if (subqueryMetrics.length > 0 && typeof input.timeScale === "number") {
    return buildDateBucketedPipelineQuery({
      input,
      simpleMetrics,
      pipelineMetrics: subqueryMetrics,
      groupByColumn,
      groupByHandlesUnknown,
      joinClauses,
      baseWhere,
      filterWhere,
      filterParams: allTranslationParams,
      timeZone,
    });
  }

  // Build SELECT expressions for standard query
  const selectExprs: string[] = [];

  // Add period indicator
  selectExprs.push(`
    CASE
      WHEN ${ts}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ts}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)} THEN 'previous'
    END AS period
  `);

  // Add date grouping (timeScale "full" already handled above via CTE query)
  if (typeof input.timeScale === "number") {
    const dateTrunc = getDateTruncFunction(input.timeScale, timeZone);
    selectExprs.push(`${dateTrunc} AS date`);
  }

  // Add groupBy column if present
  // - If handlesUnknown is true, the column expression already handles NULL/empty -> 'unknown'
  // - Otherwise, exclude empty strings via HAVING (ES terms excludes them)
  if (groupByColumn) {
    if (groupByHandlesUnknown) {
      // Column already handles 'unknown' conversion, just use as group_key
      selectExprs.push(`${groupByColumn} AS group_key`);
    } else {
      // Convert NULL to 'unknown' for ES `missing: "unknown"` behavior
      selectExprs.push(
        `if(${groupByColumn} IS NULL, 'unknown', toString(${groupByColumn})) AS group_key`,
      );
    }
  }

  // Add metric expressions
  for (const metric of simpleMetrics) {
    selectExprs.push(metric.selectExpression);
  }

  // Build GROUP BY
  const groupByExprs: string[] = ["period"];
  if (typeof input.timeScale === "number") {
    groupByExprs.push("date");
  }
  if (groupByColumn) {
    groupByExprs.push("group_key");
  }

  const havingClause = buildGroupKeyHavingClause({
    groupByColumn,
    groupByHandlesUnknown,
    groupBy: input.groupBy,
    groupByKey: input.groupByKey,
  });

  const traceColumns = referencedTraceColumns(metricTranslations, [
    filterWhere,
    groupByColumn ?? "",
    joinClauses,
  ]);

  // Build the complete SQL
  const sql = `
    SELECT
      ${selectExprs.join(",\n      ")}
    FROM ${dedupedTraceSummaries(ts, traceColumns, DATE_FILTER_BOTH_PERIODS)}
    ${joinClauses}
    WHERE ${baseWhere}
      ${filterWhere}
    GROUP BY ${groupByExprs.join(", ")}
    ${havingClause}
    ORDER BY period${typeof input.timeScale === "number" ? ", date" : ""}
  `;

  return {
    sql,
    params: {
      tenantId: input.projectId,
      currentStart: input.startDate,
      currentEnd: input.endDate,
      previousStart: input.previousPeriodStartDate,
      previousEnd: input.startDate,
      ...allTranslationParams,
      ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
    },
  };
}

/**
 * Build a timeseries query for the standard (non-arrayJoin) path that mixes
 * trace-level metrics with evaluation metrics.
 *
 * @regression issue #3088 — the naive join between trace_summaries and
 * evaluation_runs fans out each trace into N rows (one per evaluation run),
 * which inflates trace-level aggregations (sum/avg of TotalCost etc.) by N.
 *
 * This function wraps the scan in a `per_trace_metrics` CTE that pre-aggregates
 * at `(period, date[, group_key], TraceId)` granularity: trace-level columns
 * are collapsed with `any()` and evaluation metrics are computed as per-trace
 * conditional aggregations. The outer query then re-aggregates across traces
 * using the outer aggregation mapped from the conditional aggregation.
 */
function buildMixedEvalTimeseriesQuery({
  input,
  ts,
  simpleMetrics,
  groupByColumn,
  groupByHandlesUnknown,
  joinClauses,
  baseWhere,
  filterWhere,
  allTranslationParams,
  timeZone,
}: {
  input: TimeseriesQueryInput;
  ts: string;
  simpleMetrics: MetricTranslation[];
  groupByColumn: string | null;
  groupByHandlesUnknown: boolean;
  joinClauses: string;
  baseWhere: string;
  filterWhere: string;
  allTranslationParams: Record<string, unknown>;
  timeZone: string;
}): BuiltQuery {
  const traceColumns = referencedTraceColumns(simpleMetrics, [
    filterWhere,
    groupByColumn ?? "",
    joinClauses,
  ]);

  const dateTrunc =
    typeof input.timeScale === "number"
      ? getDateTruncFunction(input.timeScale, timeZone)
      : null;

  const groupKeyExpr = groupByColumn
    ? groupByHandlesUnknown
      ? `${groupByColumn} AS group_key`
      : `if(${groupByColumn} IS NULL, 'unknown', toString(${groupByColumn})) AS group_key`
    : null;

  // Inner CTE: per-trace granularity. Trace-level columns are collapsed with
  // `any()` since they're constant per TraceId. Eval metrics keep their full
  // conditional aggregation expression — but now evaluated per trace.
  const innerSelectExprs: string[] = [
    `${ts}.TraceId AS trace_id`,
    `CASE
      WHEN ${ts}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ts}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)} THEN 'previous'
    END AS period`,
  ];
  if (dateTrunc) {
    innerSelectExprs.push(`${dateTrunc} AS date`);
  }
  if (groupKeyExpr) {
    innerSelectExprs.push(groupKeyExpr);
  }

  // Per-metric plan for the outer SELECT. Each simple metric gets a column
  // in the inner CTE and a corresponding re-aggregation in the outer SELECT.
  //
  //   Eval metric: inner emits the full conditional aggregation per trace;
  //                outer re-aggregates across traces via mapEvalAggregationToOuter.
  //   Trace metric: inner emits `any(<underlying column>)` per trace; outer
  //                 applies the original aggregation to the per-trace column,
  //                 preserving coalesce/quantile wrappers by substituting the
  //                 column reference in the original expression.
  //
  // Per-trace aliases start with the metric index digit (e.g. `0__…`), so we
  // wrap them in `quoteIdentifier` to satisfy ClickHouse's identifier rules.
  const outerMetricExprs: string[] = [];
  for (const metric of simpleMetrics) {
    const perTraceAlias = quoteIdentifier(`${metric.alias}__per_trace`);
    const quotedAlias = quoteIdentifier(metric.alias);
    const exprWithoutAlias = stripSelectExpressionAlias(
      metric.selectExpression,
      metric.alias,
    );

    if (metric.requiredJoins.includes("evaluation_runs")) {
      innerSelectExprs.push(`${exprWithoutAlias} AS ${perTraceAlias}`);
      const outerAgg = mapEvalAggregationToOuter(metric.selectExpression);
      if (!outerAgg) {
        throw new Error(
          `Cannot map evaluation metric aggregation to outer aggregation for expression: "${metric.selectExpression}". ` +
            `This likely means metric-translator.ts emits a conditional aggregation pattern that mapEvalAggregationToOuter doesn't yet handle. ` +
            `Update AGGREGATION_PATTERNS in mapEvalAggregationToOuter to add the new mapping.`,
        );
      }
      outerMetricExprs.push(`${outerAgg}(${perTraceAlias}) AS ${quotedAlias}`);
      continue;
    }

    // Count-like metrics: in a per-trace CTE each trace is one row, so
    // count() / count(*) becomes sum(1) across traces = count(distinct traces).
    if (/\bcount\s*\(\s*\*?\s*\)/.test(exprWithoutAlias)) {
      innerSelectExprs.push(`1 AS ${perTraceAlias}`);
      outerMetricExprs.push(`sum(${perTraceAlias}) AS ${quotedAlias}`);
      continue;
    }

    // uniq/uniqExact of TraceId — same as count: 1 per trace row.
    if (
      (/\buniq\s*\(/.test(exprWithoutAlias) ||
        /\buniqExact\s*\(/.test(exprWithoutAlias)) &&
      exprWithoutAlias.includes("TraceId")
    ) {
      innerSelectExprs.push(`1 AS ${perTraceAlias}`);
      outerMetricExprs.push(`sum(${perTraceAlias}) AS ${quotedAlias}`);
      continue;
    }

    // Trace metric. Find the underlying column reference, wrap it in any()
    // inside the CTE, then re-aggregate across traces outside by substituting
    // the column reference with the per-trace alias in the original expression.
    const column = extractTraceAggregationColumn(exprWithoutAlias);
    if (!column) {
      // Fail loud: without a unique source column we cannot dedupe per-trace.
      // A silent fallback (e.g. any(uniqIf(...))) produces invalid nested
      // aggregations and silently-wrong metric values. Throwing forces any
      // new trace-metric shape to be handled explicitly in
      // extractTraceAggregationColumn rather than corrupting query results.
      throw new Error(
        `Cannot identify source column in trace metric expression for per-trace CTE: "${exprWithoutAlias}". ` +
          `This likely means a new trace metric shape is not handled by extractTraceAggregationColumn.`,
      );
    }
    innerSelectExprs.push(`any(${column}) AS ${perTraceAlias}`);
    const outerExpr = replaceColumnWithAlias(
      exprWithoutAlias,
      column,
      perTraceAlias,
    );
    outerMetricExprs.push(`${outerExpr} AS ${quotedAlias}`);
  }

  const innerGroupBy: string[] = ["trace_id", "period"];
  if (dateTrunc) innerGroupBy.push("date");
  if (groupKeyExpr) innerGroupBy.push("group_key");

  // Outer SELECT: re-aggregate across traces.
  const outerSelectExprs: string[] = ["period"];
  if (dateTrunc) outerSelectExprs.push("date");
  if (groupKeyExpr) outerSelectExprs.push("group_key");
  outerSelectExprs.push(...outerMetricExprs);

  const outerGroupBy: string[] = ["period"];
  if (dateTrunc) outerGroupBy.push("date");
  if (groupKeyExpr) outerGroupBy.push("group_key");

  const havingClause = buildGroupKeyHavingClause({
    groupByColumn,
    groupByHandlesUnknown,
    groupBy: input.groupBy,
    groupByKey: input.groupByKey,
  });

  // For timeScale "full" without groupBy, split into per-period CTEs with UNION ALL
  // to guarantee both 'current' and 'previous' rows always appear (even when one
  // period has no data). This matches the pattern used by buildSubqueryTimeseriesQuery.
  if (input.timeScale === "full" && !groupByColumn) {
    // Build inner SELECT without the period CASE — each CTE covers one period.
    const periodInnerExprs = innerSelectExprs.filter(
      (expr) => !expr.includes("AS period"),
    );
    const periodInnerGroupBy = innerGroupBy.filter((col) => col !== "period");

    const buildPeriodCte = (
      cteName: string,
      startParam: string,
      endParam: string,
    ): string => `
      ${cteName} AS (
        SELECT
          ${periodInnerExprs.join(",\n          ")}
        FROM ${dedupedTraceSummaries(ts, traceColumns, `AND OccurredAt >= {${startParam}:DateTime64(3)} AND OccurredAt < {${endParam}:DateTime64(3)}`)}
        ${joinClauses}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {${startParam}:DateTime64(3)} AND ${ts}.OccurredAt < {${endParam}:DateTime64(3)}
          ${filterWhere}
        GROUP BY ${periodInnerGroupBy.join(", ")}
      )`;

    // Outer metric exprs only (no period/date/group_key — those are handled separately).
    const outerMetricOnly = outerMetricExprs.join(", ");

    const sql = `
      WITH
        ${buildPeriodCte("per_trace_metrics_current", "currentStart", "currentEnd")},
        ${buildPeriodCte("per_trace_metrics_previous", "previousStart", "previousEnd")}
      SELECT 'current' AS period, ${outerMetricOnly} FROM per_trace_metrics_current
      UNION ALL
      SELECT 'previous' AS period, ${outerMetricOnly} FROM per_trace_metrics_previous
    `;

    return {
      sql,
      params: {
        tenantId: input.projectId,
        currentStart: input.startDate,
        currentEnd: input.endDate,
        previousStart: input.previousPeriodStartDate,
        previousEnd: input.startDate,
        ...allTranslationParams,
        ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
      },
    };
  }

  const sql = `
    WITH per_trace_metrics AS (
      SELECT
        ${innerSelectExprs.join(",\n        ")}
      FROM ${dedupedTraceSummaries(ts, traceColumns, DATE_FILTER_BOTH_PERIODS)}
      ${joinClauses}
      WHERE ${baseWhere}
        ${filterWhere}
      GROUP BY ${innerGroupBy.join(", ")}
    )
    SELECT
      ${outerSelectExprs.join(",\n      ")}
    FROM per_trace_metrics
    WHERE period IS NOT NULL
    GROUP BY ${outerGroupBy.join(", ")}
    ${havingClause}
    ORDER BY period${dateTrunc ? ", date" : ""}
  `;

  return {
    sql,
    params: {
      tenantId: input.projectId,
      currentStart: input.startDate,
      currentEnd: input.endDate,
      previousStart: input.previousPeriodStartDate,
      previousEnd: input.startDate,
      ...allTranslationParams,
      ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
    },
  };
}

/**
 * True when the query mixes evaluation metrics (which fan out via the
 * evaluation_runs JOIN) with non-evaluation metrics whose aggregations would
 * be inflated by that fan-out. Gates the per-trace CTE path that fixes
 * issue #3088.
 */
function hasEvalMixedWithTraceMetrics(
  metrics: readonly MetricTranslation[],
): boolean {
  const hasEval = metrics.some((m) =>
    m.requiredJoins.includes("evaluation_runs"),
  );
  const hasNonEval = metrics.some(
    (m) => !m.requiredJoins.includes("evaluation_runs"),
  );
  return hasEval && hasNonEval;
}

/**
 * Extract the underlying column reference from a trace-level metric expression.
 *
 * Handles common shapes produced by `translateSimpleAggregation` and related
 * helpers in `metric-translator.ts`:
 *   - `coalesce(sum(ts.TotalCost), 0)` -> `ts.TotalCost`
 *   - `sum(ts.TotalCost)` -> `ts.TotalCost`
 *   - `quantileExact(0.5)(ts.TotalDurationMs)` -> `ts.TotalDurationMs`
 *   - `uniq(ts.TraceId)` -> `ts.TraceId`
 *   - `uniqIf(ts.Attributes['langwatch.user_id'], ...)` -> `ts.Attributes['langwatch.user_id']`
 *
 * Returns `null` when no single column reference can be unambiguously extracted
 * (e.g. expressions with arithmetic or multiple column references). Callers
 * must treat `null` as a programmer error — the mixed eval/trace CTE cannot
 * produce correct SQL without a unique source column to collapse per trace.
 */
function extractTraceAggregationColumn(expression: string): string | null {
  // 1. Prefer a bracketed map-access column like `ts.Attributes['langwatch.user_id']`
  //    or `ts.Attributes["langwatch.user_id"]`. ClickHouse accepts both quote
  //    styles. Map keys can contain arbitrary characters except the matching
  //    quote, so we match non-greedily to the closing quote + bracket.
  const bracketedPattern =
    /[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*\[(?:'[^']*'|"[^"]*")\]/g;
  const bracketedMatches = expression.match(bracketedPattern);
  if (bracketedMatches && bracketedMatches.length > 0) {
    return bracketedMatches[bracketedMatches.length - 1] ?? null;
  }

  // 2. Fall back to `<alias>.<column>` or `<alias>."Quoted.Column"`.
  //    Trace metrics produced by `translateSimpleAggregation` always contain
  //    exactly one such reference, so this is unambiguous.
  const columnPattern =
    /[a-zA-Z_][a-zA-Z0-9_]*\.(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)/g;
  const matches = expression.match(columnPattern);
  if (!matches || matches.length === 0) return null;
  // Return the last (innermost) match to skip function-like identifiers.
  return matches[matches.length - 1] ?? null;
}

/**
 * Replace all occurrences of a column reference in an expression with a new
 * alias. Used to rewrite the outer SELECT of a mixed eval/trace query so that
 * the original aggregation (including wrappers like `coalesce(..., 0)`) applies
 * to the per-trace column instead of the raw column.
 *
 * The boundary check uses `(?<![\w.])` / `(?![\w.])` rather than `\b` because
 * `\b` treats `.` as a word boundary, which would incorrectly match `ts.Total`
 * inside `ts.TotalCost`. For bracketed expressions like
 * `ts.Attributes['langwatch.user_id']` the closing `]` is followed by `,`/`)`
 * which satisfies the lookahead.
 */
function replaceColumnWithAlias(
  expression: string,
  column: string,
  alias: string,
): string {
  // Escape regex metacharacters in the column reference before replacing.
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Anchor with negative lookbehind/lookahead so `ts.TotalCost` does not match
  // inside `ts.TotalCostRatio`, and `ts.Attributes['x']` does not match inside
  // some hypothetical `ats.Attributes['x']`.
  return expression.replace(
    new RegExp(`(?<![\\w.])${escaped}(?![\\w.])`, "g"),
    alias,
  );
}

/**
 * Build a timeseries query using CTE for arrayJoin grouping (labels, events)
 * or span-level grouping (model, span_type).
 * This prevents trace duplication from affecting aggregate counts.
 */
function buildArrayJoinTimeseriesQuery({
  input,
  groupByColumn,
  groupByHandlesUnknown,
  metricTranslations,
  joinClauses,
  baseWhere,
  filterWhere,
  filterParams,
  timeZone,
  spanModelPartitioned = false,
}: {
  input: TimeseriesQueryInput;
  groupByColumn: string;
  groupByHandlesUnknown: boolean;
  metricTranslations: MetricTranslation[];
  joinClauses: string;
  baseWhere: string;
  filterWhere: string;
  filterParams: Record<string, unknown>;
  timeZone: string;
  spanModelPartitioned?: boolean;
}): BuiltQuery {
  const ts = tableAliases.trace_summaries;

  // Build date truncation for CTE
  const dateTrunc =
    input.timeScale !== "full" && typeof input.timeScale === "number"
      ? getDateTruncFunction(input.timeScale, timeZone)
      : null;

  // CTE: Get distinct (TraceId, group_key) pairs with per-trace metrics
  // This ensures each trace is counted once per group key value
  // If groupByColumn already handles 'unknown' conversion (like model, span_type),
  // just use it directly. Otherwise, wrap with if(...IS NULL, 'unknown', ...).
  const groupKeyExpr = groupByHandlesUnknown
    ? `${groupByColumn} AS group_key`
    : `if(${groupByColumn} IS NULL, 'unknown', toString(${groupByColumn})) AS group_key`;

  const periodCaseExpr = `CASE
      WHEN ${ts}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ts}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)} THEN 'previous'
    END`;

  // Separate eval and non-eval metrics so we can pre-aggregate evaluation metrics
  // at trace granularity inside the CTE. Without this, the evaluation_runs JOIN
  // fans out each trace into N rows (one per evaluation run), and the raw
  // `es.Passed` / `es.Score` expressions leak into the outer SELECT where the
  // `es` alias no longer exists.
  //
  // @regression issue #3088
  const simpleMetrics = metricTranslations.filter((m) => !m.requiresSubquery);

  // Pipeline metrics that group by trace_id are redundant in the arrayJoin
  // path because the CTE already deduplicates by (trace_id, group_key): each
  // trace contributes at most one row per group, so the inner `<agg> BY
  // trace_id` step becomes identity for trace-level columns. Re-translate
  // these as simple metrics so they participate in the outer SELECT instead
  // of being silently dropped (which is what the `avgCostPerModel` and
  // `avgTokensPerModel` dashboard widgets were hitting — they emit
  // `pipeline: {field: trace_id, aggregation: avg}` and got blanked out).
  //
  // Safe for sum/avg/min/max: on a per-trace scalar `v`, the inner
  // aggregation collapses to `v` for all four, so the outer aggregation
  // equals the standard aggregation over deduped traces. Other inner
  // aggregations (quantile, uniq, etc.) are intentionally left to fall
  // through — they'd need separate reasoning.
  const TRACE_ID_PIPELINE_SAFE_AGGS = new Set<string>([
    "sum",
    "avg",
    "min",
    "max",
  ]);
  for (let i = 0; i < input.series.length; i++) {
    const series = input.series[i]!;
    const translation = metricTranslations[i]!;
    if (!translation.requiresSubquery || !series.pipeline) continue;

    if (
      series.pipeline.field === "trace_id" &&
      TRACE_ID_PIPELINE_SAFE_AGGS.has(series.pipeline.aggregation)
    ) {
      const innerTranslation = translateMetric(
        series.metric,
        series.aggregation,
        i,
        series.key,
        series.subkey,
      );
      // Swap alias to match the pipeline translation's alias (they're identical
      // for trace_id pipelines, but be explicit for clarity)
      const escapedAlias = innerTranslation.alias.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      simpleMetrics.push({
        ...innerTranslation,
        alias: translation.alias,
        selectExpression: innerTranslation.selectExpression.replace(
          new RegExp(` AS ${escapedAlias}$`),
          ` AS ${translation.alias}`,
        ),
      });
    }
  }
  const hasEvalMixWithTrace = hasEvalMixedWithTraceMetrics(simpleMetrics);

  // When eval metrics are mixed with trace metrics, switch from SELECT DISTINCT
  // (which cannot dedupe the eval fan-out because eval columns differ per row)
  // to GROUP BY trace_id, group_key, period [, date], wrapping trace-level columns
  // in any() and computing eval metrics as per-trace aggregates. The outer query
  // then re-aggregates the per-trace eval values via mapEvalAggregationToOuter().

  const cteSelectExprs: string[] = [
    `${ts}.TraceId AS trace_id`,
    groupKeyExpr,
    `${periodCaseExpr} AS period`,
  ];

  if (dateTrunc) {
    cteSelectExprs.push(`${dateTrunc} AS date`);
  }

  // Include metric base columns in CTE for aggregation in outer query.
  // When using the grouped CTE, wrap trace-level columns in any() since they
  // are constant per (trace_id, group_key) combination.
  const traceColumnWrapper = (col: string) =>
    hasEvalMixWithTrace ? `any(${col})` : col;
  // IMPORTANT: When adding a new trace-level column to metric-translator.ts, it
  // MUST also be added to this CTE select list AND to dedupSubstitutions()
  // (consumed by transformMetricForDedup below). The simple-path
  // buildMixedEvalTimeseriesQuery uses dynamic column extraction via
  // extractTraceAggregationColumn, but this arrayJoin path still uses the
  // hard-coded approach. Missing the update here will make the new column
  // silently return null (or throw) when combined with an arrayJoin groupBy.
  // TODO(#3115): port this path to extractTraceAggregationColumn for parity.
  //
  // For the span-partitioned model grouping, the additive (span-attributable)
  // columns carry the (trace, model) bucket's OWN share from the `smd` join
  // instead of the whole-trace value, so the outer sums partition exactly.
  // Traces without a joined smd row (log-only traces, spans outside the scan
  // window) keep the trace-level value: the group-by expression gives those
  // traces exactly one bucket, so whole-trace attribution stays a partition.
  // Non-additive trace-level columns (duration, TTFT, tokens/second) keep
  // whole-trace attribution in every bucket the trace touched.
  const smdMiss = spanModelPartitionMissExpr();
  const partitionedOrTrace = (bucketExpr: string, traceExpr: string) =>
    spanModelPartitioned
      ? `if(${smdMiss}, ${traceExpr}, ${bucketExpr})`
      : traceExpr;
  // The effective non-billed cost (column + legacy-marker fallback) is only
  // materialized when a requested metric reads it, because the fallback reads
  // the wide ts.Attributes map and would otherwise widen the dedup subquery
  // for every grouped query.
  const needsNonBilledCost = simpleMetrics.some((m) =>
    m.selectExpression.includes("NonBilledCost"),
  );
  // Bucket-level non-billed cost mirrors nonBilledCostExpression's precedence
  // exactly: the fold-time per-span split wins; the legacy all-or-nothing
  // `langwatch.cost.non_billable` trace marker only kicks in when the
  // trace-level NonBilledCost column is NULL (rows folded before the column
  // existed). The marker classifies the WHOLE trace as bundled, so under it
  // every bucket's non-billed share equals the bucket's cost, keeping the
  // buckets an exact partition of the trace expression.
  const bucketNonBilledExpr = needsNonBilledCost
    ? `if(${ts}.NonBilledCost IS NULL AND ${ts}.Attributes['langwatch.cost.non_billable'] = 'true', ${SPAN_MODEL_ALIAS}.SpanModelCost, ${SPAN_MODEL_ALIAS}.SpanModelNonBilledCost)`
    : `${SPAN_MODEL_ALIAS}.SpanModelNonBilledCost`;
  const needsCacheTokenColumns = simpleMetrics.some(
    (m) =>
      m.selectExpression.includes("langwatch.reserved.cache_read_tokens") ||
      m.selectExpression.includes("langwatch.reserved.cache_creation_tokens") ||
      m.selectExpression.includes("langwatch.reserved.reasoning_tokens"),
  );
  cteSelectExprs.push(
    `${traceColumnWrapper(partitionedOrTrace(`${SPAN_MODEL_ALIAS}.SpanModelCost`, `${ts}.TotalCost`))} AS trace_total_cost`,
  );
  cteSelectExprs.push(
    `${traceColumnWrapper(
      partitionedOrTrace(
        bucketNonBilledExpr,
        needsNonBilledCost
          ? nonBilledCostExpression(ts)
          : `${ts}.NonBilledCost`,
      ),
    )} AS trace_non_billed_cost`,
  );
  cteSelectExprs.push(
    `${traceColumnWrapper(`${ts}.TotalDurationMs`)} AS trace_duration_ms`,
  );
  cteSelectExprs.push(
    `${traceColumnWrapper(partitionedOrTrace(`${SPAN_MODEL_ALIAS}.SpanModelPromptTokens`, `${ts}.TotalPromptTokenCount`))} AS trace_prompt_tokens`,
  );
  cteSelectExprs.push(
    `${traceColumnWrapper(partitionedOrTrace(`${SPAN_MODEL_ALIAS}.SpanModelCompletionTokens`, `${ts}.TotalCompletionTokenCount`))} AS trace_completion_tokens`,
  );
  cteSelectExprs.push(
    `${traceColumnWrapper(`${ts}.TokensPerSecond`)} AS trace_tokens_per_second`,
  );
  cteSelectExprs.push(
    `${traceColumnWrapper(`${ts}.TimeToFirstTokenMs`)} AS trace_time_to_first_token_ms`,
  );
  // Hoist only the attribute reads a requested metric actually aggregates.
  // Pushing all of them would widen the dedup subquery with the wide
  // Attributes map for every grouped query — the same cost the conditional
  // cache-token hoist below exists to avoid.
  for (const { attributeKey, cteColumn } of TRACE_ATTRIBUTE_METRIC_COLUMNS) {
    const source = traceAttributeSource(attributeKey);
    if (!simpleMetrics.some((m) => m.selectExpression.includes(source))) {
      continue;
    }
    cteSelectExprs.push(`${traceColumnWrapper(source)} AS ${cteColumn}`);
  }
  if (needsCacheTokenColumns) {
    // toFloat64 wraps the UInt64 attribute read so both if() branches share a
    // supertype with the smd join's Float64 sums.
    cteSelectExprs.push(
      `${traceColumnWrapper(
        partitionedOrTrace(
          `${SPAN_MODEL_ALIAS}.SpanModelCacheReadTokens`,
          `toFloat64(toUInt64OrZero(${ts}.Attributes['langwatch.reserved.cache_read_tokens']))`,
        ),
      )} AS trace_cache_read_tokens`,
    );
    cteSelectExprs.push(
      `${traceColumnWrapper(
        partitionedOrTrace(
          `${SPAN_MODEL_ALIAS}.SpanModelCacheWriteTokens`,
          `toFloat64(toUInt64OrZero(${ts}.Attributes['langwatch.reserved.cache_creation_tokens']))`,
        ),
      )} AS trace_cache_write_tokens`,
    );
    cteSelectExprs.push(
      `${traceColumnWrapper(
        partitionedOrTrace(
          `${SPAN_MODEL_ALIAS}.SpanModelReasoningTokens`,
          `toFloat64(toUInt64OrZero(${ts}.Attributes['langwatch.reserved.reasoning_tokens']))`,
        ),
      )} AS trace_reasoning_tokens`,
    );
  }

  // When pre-aggregating eval metrics per-trace, emit each eval metric's full
  // expression (without its alias) as a `<alias>__per_trace` column inside the
  // CTE. In the outer query, we'll wrap this per-trace column in the cross-trace
  // aggregation returned by mapEvalAggregationToOuter().
  //
  // Per-trace aliases are quoted because they start with the metric index digit.
  const evalPerTraceAliases = new Map<string, string>();
  if (hasEvalMixWithTrace) {
    for (const metric of simpleMetrics) {
      if (!metric.requiredJoins.includes("evaluation_runs")) continue;
      const perTraceAlias = quoteIdentifier(`${metric.alias}__per_trace`);
      const exprWithoutAlias = stripSelectExpressionAlias(
        metric.selectExpression,
        metric.alias,
      );
      cteSelectExprs.push(`${exprWithoutAlias} AS ${perTraceAlias}`);
      evalPerTraceAliases.set(metric.alias, perTraceAlias);
    }
  }

  // Include evaluation columns in CTE when evaluation metrics are used.
  // When hasEvalMixWithTrace is true the CTE uses GROUP BY (not SELECT DISTINCT),
  // so non-grouped columns must be wrapped in any(). The raw eval columns are
  // only consumed by the non-mixed transformMetricForDedup path, but wrapping
  // them keeps the CTE valid for both modes.
  const es = tableAliases.evaluation_runs;
  const metricExprs = simpleMetrics.map((m) => m.selectExpression);
  const referencedEvalCols = extractReferencedEvaluationColumns(metricExprs);
  for (const col of referencedEvalCols) {
    const colExpr = `${es}.${col}`;
    cteSelectExprs.push(
      `${hasEvalMixWithTrace ? `any(${colExpr})` : colExpr} AS eval_${snakeCase(col)}`,
    );
  }

  // Build outer SELECT expressions
  const outerSelectExprs: string[] = ["period"];
  if (dateTrunc) {
    outerSelectExprs.push("date");
  }
  outerSelectExprs.push("group_key");

  // Transform metrics to work on deduplicated data
  // count() becomes uniqExact(trace_id), sum/avg work on first value per trace
  for (const metric of simpleMetrics) {
    const perTraceAlias = evalPerTraceAliases.get(metric.alias);
    if (perTraceAlias !== undefined) {
      // Eval metric: outer query re-aggregates the per-trace value across traces.
      const outerAgg = mapEvalAggregationToOuter(metric.selectExpression);
      if (!outerAgg) {
        throw new Error(
          `Cannot map evaluation metric aggregation to outer aggregation for expression: "${metric.selectExpression}". ` +
            `This likely means metric-translator.ts emits a conditional aggregation pattern that mapEvalAggregationToOuter doesn't yet handle. ` +
            `Update AGGREGATION_PATTERNS in mapEvalAggregationToOuter to add the new mapping.`,
        );
      }
      outerSelectExprs.push(
        `${outerAgg}(${perTraceAlias}) AS ${quoteIdentifier(metric.alias)}`,
      );
      continue;
    }
    // Transform the metric expression for the deduplicated context
    const transformedExpr = transformMetricForDedup(
      metric.selectExpression,
      metric.alias,
    );
    outerSelectExprs.push(transformedExpr);
  }

  // Build GROUP BY for outer query
  const outerGroupBy: string[] = ["period"];
  if (dateTrunc) {
    outerGroupBy.push("date");
  }
  outerGroupBy.push("group_key");

  // Build HAVING clause - only apply for string-type fields that don't handle unknown
  // Skip for boolean fields like evaluations.evaluation_passed (which use 0/1, not empty strings)
  const havingClause =
    !groupByHandlesUnknown && input.groupBy !== "evaluations.evaluation_passed"
      ? "HAVING group_key != ''"
      : "";

  // Columns the dedup subquery must expose: everything the CTE's SELECT list
  // (which hardcodes per-trace passthroughs like ts.NonBilledCost regardless of
  // the requested metrics) and the filter reference. Derived from the assembled
  // expressions rather than the metric list so no referenced column is pruned.
  const traceColumns = referencedTraceColumns(
    [],
    [...cteSelectExprs, filterWhere, joinClauses],
  );

  // The span-model partition join fans each trace out into one row per model
  // its spans used; it rides ALONGSIDE any generic filter/metric JOINs, whose
  // per-span fan-out the CTE's DISTINCT / GROUP BY collapses as before.
  const cteJoinClauses = spanModelPartitioned
    ? [joinClauses, buildSpanModelPartitionJoin(SPAN_TIME_FILTER_BOTH_PERIODS)]
        .filter(Boolean)
        .join("\n")
    : joinClauses;

  // CTE body: use GROUP BY when pre-aggregating eval metrics per trace,
  // otherwise fall back to SELECT DISTINCT for backward-compatible behavior.
  let cteBody: string;
  if (hasEvalMixWithTrace) {
    const cteGroupByCols: string[] = ["trace_id", "group_key", "period"];
    if (dateTrunc) cteGroupByCols.push("date");
    cteBody = `
      SELECT
        ${cteSelectExprs.join(",\n        ")}
      FROM ${dedupedTraceSummaries(ts, traceColumns, DATE_FILTER_BOTH_PERIODS)}
      ${cteJoinClauses}
      WHERE ${baseWhere}
        ${filterWhere}
      GROUP BY ${cteGroupByCols.join(", ")}
    `;
  } else {
    cteBody = `
      SELECT DISTINCT
        ${cteSelectExprs.join(",\n        ")}
      FROM ${dedupedTraceSummaries(ts, traceColumns, DATE_FILTER_BOTH_PERIODS)}
      ${cteJoinClauses}
      WHERE ${baseWhere}
        ${filterWhere}
    `;
  }

  // When the groupBy field uses arrayJoin (e.g. metadata.labels) and a filter
  // exists for the same field, the trace-level filter (hasAny) only selects
  // traces that have at least one matching value. But arrayJoin then expands
  // ALL values from those traces, so unfiltered values leak into the results.
  // Add a group_key restriction in the outer query to show only the filtered values.
  let groupKeyFilter = "";
  const groupKeyFilterParams: Record<string, unknown> = {};
  if (input.groupBy && input.filters && groupByColumn.includes("arrayJoin")) {
    const filterValues =
      input.filters[input.groupBy as keyof typeof input.filters];
    if (Array.isArray(filterValues) && filterValues.length > 0) {
      const paramName = "groupByFilterValues";
      groupKeyFilter = `AND group_key IN ({${paramName}:Array(String)})`;
      groupKeyFilterParams[paramName] = filterValues;
    }
  }

  const sql = `
    WITH deduped_traces AS (${cteBody})
    SELECT
      ${outerSelectExprs.join(",\n      ")}
    FROM deduped_traces
    WHERE period IS NOT NULL
      ${groupKeyFilter}
    GROUP BY ${outerGroupBy.join(", ")}
    ${havingClause}
    ORDER BY period${dateTrunc ? ", date" : ""}
  `;

  return {
    sql,
    params: {
      tenantId: input.projectId,
      currentStart: input.startDate,
      currentEnd: input.endDate,
      previousStart: input.previousPeriodStartDate,
      previousEnd: input.startDate,
      ...filterParams,
      ...groupKeyFilterParams,
      ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
    },
  };
}

/**
 * Build the UNION ALL SQL for the groupBy path in buildSubqueryTimeseriesQuery.
 * Returns the complete SQL + params object when groupByColumn is active.
 *
 * Each branch handles a different combination of metric types:
 * - simple only: SELECT directly from simple_metrics CTEs
 * - single subquery only: SELECT directly from that metric's CTE
 * - mixed / multiple subquery: FULL OUTER JOIN all CTEs on group_key
 */
function buildGroupByUnionAllQuery({
  input,
  ctes,
  simpleMetrics,
  subqueryMetrics,
  filterParams,
}: {
  input: TimeseriesQueryInput;
  ctes: string[];
  simpleMetrics: MetricTranslation[];
  subqueryMetrics: MetricTranslation[];
  filterParams: Record<string, unknown>;
}): BuiltQuery {
  const simpleAliases = simpleMetrics.map((m) => quoteIdentifier(m.alias));
  const subqueryAliasExprs = subqueryMetrics.map(
    (m) => `metric_value AS ${quoteIdentifier(m.alias)}`,
  );

  const currentParts: string[] = ["'current' AS period", "group_key"];
  const previousParts: string[] = ["'previous' AS period", "group_key"];

  let currentFrom = "";
  let previousFrom = "";

  if (simpleMetrics.length > 0 && subqueryMetrics.length === 0) {
    // Simple metrics only: SELECT directly from the simple_metrics CTEs
    currentParts.push(...simpleAliases);
    previousParts.push(...simpleAliases);
    currentFrom = "FROM simple_metrics_current";
    previousFrom = "FROM simple_metrics_previous";
  } else if (simpleMetrics.length === 0 && subqueryMetrics.length === 1) {
    // Single subquery metric only: SELECT directly from the subquery CTE
    const singleSubquery = subqueryMetrics[0];
    const singleAliasExpr = subqueryAliasExprs[0];
    if (!singleSubquery || !singleAliasExpr) {
      throw new Error("Expected exactly one subquery metric");
    }
    const cteName = `cte_${singleSubquery.alias}`;
    currentParts.push(singleAliasExpr);
    previousParts.push(singleAliasExpr);
    currentFrom = `FROM ${cteName}_current`;
    previousFrom = `FROM ${cteName}_previous`;
  } else if (simpleMetrics.length > 0 || subqueryMetrics.length > 0) {
    // Mixed or multiple subquery metrics: JOIN the CTEs on group_key
    const allCurrentSources: string[] = [];
    const allPreviousSources: string[] = [];
    const allCurrentCols: string[] = [];
    const allPreviousCols: string[] = [];

    if (simpleMetrics.length > 0) {
      allCurrentSources.push("simple_metrics_current smc");
      allPreviousSources.push("simple_metrics_previous smp");
      simpleAliases.forEach((a) => {
        allCurrentCols.push(`smc.${a}`);
        allPreviousCols.push(`smp.${a}`);
      });
    }

    subqueryMetrics.forEach((m, i) => {
      const cteName = `cte_${m.alias}`;
      const alias = `sq${i}`;
      const quotedAlias = quoteIdentifier(m.alias);
      if (allCurrentSources.length === 0) {
        allCurrentSources.push(`${cteName}_current ${alias}`);
        allPreviousSources.push(`${cteName}_previous ${alias}`);
      } else {
        const baseCurrentAlias = allCurrentSources[0]?.split(" ")[1] ?? alias;
        const basePreviousAlias = allPreviousSources[0]?.split(" ")[1] ?? alias;
        allCurrentSources.push(
          `FULL OUTER JOIN ${cteName}_current ${alias} ON ${baseCurrentAlias}.group_key = ${alias}.group_key`,
        );
        allPreviousSources.push(
          `FULL OUTER JOIN ${cteName}_previous ${alias} ON ${basePreviousAlias}.group_key = ${alias}.group_key`,
        );
      }
      allCurrentCols.push(`${alias}.metric_value AS ${quotedAlias}`);
      allPreviousCols.push(`${alias}.metric_value AS ${quotedAlias}`);
    });

    currentParts.push(...allCurrentCols);
    previousParts.push(...allPreviousCols);
    currentFrom = `FROM ${allCurrentSources.join("\n    ")}`;
    previousFrom = `FROM ${allPreviousSources.join("\n    ")}`;
  }

  const sql = `
    WITH
      ${ctes.join(",\n      ")}
    SELECT ${currentParts.join(", ")} ${currentFrom}
    UNION ALL
    SELECT ${previousParts.join(", ")} ${previousFrom}
  `;
  return {
    sql,
    params: {
      tenantId: input.projectId,
      currentStart: input.startDate,
      currentEnd: input.endDate,
      previousStart: input.previousPeriodStartDate,
      previousEnd: input.startDate,
      ...filterParams,
      ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
    },
  };
}

/**
 * Build a timeseries query using CTEs for subquery (pipeline) metrics.
 * This handles metrics that require two-level aggregation (e.g., avg threads per user).
 */
function buildSubqueryTimeseriesQuery(
  input: TimeseriesQueryInput,
  simpleMetrics: MetricTranslation[],
  subqueryMetrics: MetricTranslation[],
  joinClauses: string,
  baseWhere: string,
  filterWhere: string,
  filterParams: Record<string, unknown>,
  groupByColumn: string | null = null,
  groupByHandlesUnknown = false,
): BuiltQuery {
  const ts = tableAliases.trace_summaries;
  const traceColumns = referencedTraceColumns(
    [...simpleMetrics, ...subqueryMetrics],
    [filterWhere, groupByColumn ?? "", joinClauses],
  );
  const ctes: string[] = [];

  // Build group_key expression when groupBy is active, matching the pattern used in
  // buildArrayJoinTimeseriesQuery and the standard query path.
  const groupKeyExpr = groupByColumn
    ? groupByHandlesUnknown
      ? `${groupByColumn} AS group_key`
      : `if(${groupByColumn} IS NULL, 'unknown', toString(${groupByColumn})) AS group_key`
    : null;

  // Build CTEs for each subquery metric, one for current and one for previous period
  // Use 'cte_' prefix to ensure CTE names don't start with a digit (which is invalid SQL)
  for (const metric of subqueryMetrics) {
    if (!metric.subquery) continue;
    const subquery = metric.subquery;
    const cteName = `cte_${metric.alias}`;

    // When groupByColumn is set, propagate group_key into the CTE so the outer query
    // can group results by it. The group_key is added to both the inner SELECT and
    // inner GROUP BY of the subquery.
    const groupKeyInnerSelect = groupKeyExpr ? `, ${groupKeyExpr}` : "";
    const groupKeyInnerGroupBy = groupByColumn ? `, group_key` : "";

    // Check if this is a nested subquery (3-level aggregation)
    if (subquery.nestedSubquery) {
      const nested = subquery.nestedSubquery;
      const havingClause = nested.having ? `HAVING ${nested.having}` : "";

      // CTE for current period with nested subquery
      ctes.push(`
      ${cteName}_current AS (
        SELECT '${metric.alias}' AS metric_name, ${subquery.outerAggregation.replace(` AS ${metric.alias}`, "")} AS metric_value${groupKeyInnerSelect}
        FROM (
          SELECT ${subquery.innerSelect}${groupKeyInnerSelect}
          FROM (
            SELECT ${nested.select}
            FROM ${dedupedTraceSummaries(ts, traceColumns, DATE_FILTER_CURRENT)}
            ${joinClauses}
            WHERE ${ts}.TenantId = {tenantId:String}
              AND ${ts}.OccurredAt >= {currentStart:DateTime64(3)}
              AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)}
              ${filterWhere}
            GROUP BY ${nested.groupBy}
            ${havingClause}
          ) thread_data
          GROUP BY ${subquery.innerGroupBy}${groupKeyInnerGroupBy}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
        ${groupByColumn ? `GROUP BY metric_name, group_key` : ""}
      )`);

      // CTE for previous period with nested subquery
      ctes.push(`
      ${cteName}_previous AS (
        SELECT '${metric.alias}' AS metric_name, ${subquery.outerAggregation.replace(` AS ${metric.alias}`, "")} AS metric_value${groupKeyInnerSelect}
        FROM (
          SELECT ${subquery.innerSelect}${groupKeyInnerSelect}
          FROM (
            SELECT ${nested.select}
            FROM ${dedupedTraceSummaries(ts, traceColumns, DATE_FILTER_PREVIOUS)}
            ${joinClauses}
            WHERE ${ts}.TenantId = {tenantId:String}
              AND ${ts}.OccurredAt >= {previousStart:DateTime64(3)}
              AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)}
              ${filterWhere}
            GROUP BY ${nested.groupBy}
            ${havingClause}
          ) thread_data
          GROUP BY ${subquery.innerGroupBy}${groupKeyInnerGroupBy}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
        ${groupByColumn ? `GROUP BY metric_name, group_key` : ""}
      )`);
    } else {
      // Standard 2-level aggregation
      // CTE for current period
      ctes.push(`
      ${cteName}_current AS (
        SELECT '${metric.alias}' AS metric_name, ${subquery.outerAggregation.replace(` AS ${metric.alias}`, "")} AS metric_value${groupKeyInnerSelect}
        FROM (
          SELECT ${subquery.innerSelect}${groupKeyInnerSelect}
          FROM ${dedupedTraceSummaries(ts, traceColumns, DATE_FILTER_CURRENT)}
          ${joinClauses}
          WHERE ${ts}.TenantId = {tenantId:String}
            AND ${ts}.OccurredAt >= {currentStart:DateTime64(3)}
            AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)}
            ${filterWhere}
          GROUP BY ${subquery.innerGroupBy}${groupKeyInnerGroupBy}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
        ${groupByColumn ? `GROUP BY metric_name, group_key` : ""}
      )`);

      // CTE for previous period
      ctes.push(`
      ${cteName}_previous AS (
        SELECT '${metric.alias}' AS metric_name, ${subquery.outerAggregation.replace(` AS ${metric.alias}`, "")} AS metric_value${groupKeyInnerSelect}
        FROM (
          SELECT ${subquery.innerSelect}${groupKeyInnerSelect}
          FROM ${dedupedTraceSummaries(ts, traceColumns, DATE_FILTER_PREVIOUS)}
          ${joinClauses}
          WHERE ${ts}.TenantId = {tenantId:String}
            AND ${ts}.OccurredAt >= {previousStart:DateTime64(3)}
            AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)}
            ${filterWhere}
          GROUP BY ${subquery.innerGroupBy}${groupKeyInnerGroupBy}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
        ${groupByColumn ? `GROUP BY metric_name, group_key` : ""}
      )`);
    }
  }

  // Build simple metrics query for current period
  // Quote aliases that start with digits for ClickHouse compatibility
  const simpleSelectExprs: string[] = [];
  if (groupKeyExpr) {
    simpleSelectExprs.push(groupKeyExpr);
  }
  for (const metric of simpleMetrics) {
    // Replace unquoted alias with quoted alias in the selectExpression
    const quotedAlias = quoteIdentifier(metric.alias);
    const quotedExpression = metric.selectExpression.replace(
      ` AS ${metric.alias}`,
      ` AS ${quotedAlias}`,
    );
    simpleSelectExprs.push(quotedExpression);
  }

  // CTE for simple metrics current period
  const simpleGroupBy = groupByColumn ? "\n        GROUP BY group_key" : "";
  if (simpleMetrics.length > 0) {
    ctes.push(`
      simple_metrics_current AS (
        SELECT
          ${simpleSelectExprs.join(",\n          ")}
        FROM ${dedupedTraceSummaries(ts, traceColumns, DATE_FILTER_CURRENT)}
        ${joinClauses}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {currentStart:DateTime64(3)}
          AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)}
          ${filterWhere}${simpleGroupBy}
      )`);

    ctes.push(`
      simple_metrics_previous AS (
        SELECT
          ${simpleSelectExprs.join(",\n          ")}
        FROM ${dedupedTraceSummaries(ts, traceColumns, DATE_FILTER_PREVIOUS)}
        ${joinClauses}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {previousStart:DateTime64(3)}
          AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)}
          ${filterWhere}${simpleGroupBy}
      )`);
  }

  // When groupByColumn is present, delegate to the grouped UNION ALL builder.
  // Scalar subqueries cannot be used here because the CTEs now return multiple rows
  // (one per group_key value).
  if (groupByColumn) {
    return buildGroupByUnionAllQuery({
      input,
      ctes,
      simpleMetrics,
      subqueryMetrics,
      filterParams,
    });
  }

  // No groupBy: use scalar subqueries to guarantee a row even when there is
  // no data in one of the periods. Only ADDITIVE metrics coalesce the empty
  // result (0 rows returns NULL) to 0 — for averages, extrema and percentiles
  // an absent value means "no data", and a fabricated 0 would read as a real
  // measurement (e.g. a 0% pass rate for an evaluator that never ran).
  const additiveAliases = new Set(
    input.series
      .map((series, index) => ({ series, index }))
      .filter(({ series }) => isZeroWhenAbsentSeries(series))
      .map(({ series, index }) =>
        buildMetricAlias(
          index,
          series.metric,
          series.aggregation,
          series.key,
          series.subkey,
        ),
      ),
  );
  const scalarExpr = (
    subquery: string,
    alias: string,
    quotedAlias: string,
  ): string =>
    additiveAliases.has(alias)
      ? `coalesce(${subquery}, 0) AS ${quotedAlias}`
      : `${subquery} AS ${quotedAlias}`;

  const currentSelectExprs: string[] = ["'current' AS period"];
  const previousSelectExprs: string[] = ["'previous' AS period"];

  // Add simple metrics columns (quote aliases that start with digits)
  for (const metric of simpleMetrics) {
    if (simpleMetrics.length > 0) {
      const quotedAlias = quoteIdentifier(metric.alias);
      currentSelectExprs.push(
        scalarExpr(
          `(SELECT ${quotedAlias} FROM simple_metrics_current)`,
          metric.alias,
          quotedAlias,
        ),
      );
      previousSelectExprs.push(
        scalarExpr(
          `(SELECT ${quotedAlias} FROM simple_metrics_previous)`,
          metric.alias,
          quotedAlias,
        ),
      );
    }
  }

  // Add subquery metrics columns (use cte_ prefix to match CTE names, quote aliases)
  for (const metric of subqueryMetrics) {
    const cteName = `cte_${metric.alias}`;
    const quotedAlias = quoteIdentifier(metric.alias);
    currentSelectExprs.push(
      scalarExpr(
        `(SELECT metric_value FROM ${cteName}_current)`,
        metric.alias,
        quotedAlias,
      ),
    );
    previousSelectExprs.push(
      scalarExpr(
        `(SELECT metric_value FROM ${cteName}_previous)`,
        metric.alias,
        quotedAlias,
      ),
    );
  }

  const sql = `
    WITH
      ${ctes.join(",\n      ")}
    SELECT ${currentSelectExprs.join(", ")}
    UNION ALL
    SELECT ${previousSelectExprs.join(", ")}
  `;

  return {
    sql,
    params: {
      tenantId: input.projectId,
      currentStart: input.startDate,
      currentEnd: input.endDate,
      previousStart: input.previousPeriodStartDate,
      previousEnd: input.startDate,
      ...filterParams,
      ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
    },
  };
}

/**
 * Build a date-bucketed pipeline query for pipeline metrics with numeric timeScale.
 * Uses CTE-based two-level (or three-level for nested) aggregation with date bucketing.
 *
 * NOTE: This is structurally different from buildSubqueryTimeseriesQuery (timeScale="full")
 * which splits current/previous into separate CTEs joined via UNION ALL. Here, both periods
 * coexist in one CTE using a CASE-based period column + date bucketing.
 *
 * Injection safety: All user-facing values (projectId, dates, groupByKey, filter values) go
 * through ClickHouse parameterized placeholders ({tenantId:String}, etc.). The interpolated
 * SQL fragments (subquery.innerSelect, outerAggregation, groupByColumn) are produced by
 * translatePipelineAggregation/getGroupByExpression from typed enums and constant column
 * references — never from raw user input.
 *
 * Output rows: period, date, [group_key,] <metric_alias>
 */
function buildDateBucketedPipelineQuery({
  input,
  simpleMetrics = [],
  pipelineMetrics,
  groupByColumn,
  groupByHandlesUnknown,
  joinClauses,
  baseWhere,
  filterWhere,
  filterParams,
  timeZone,
}: {
  input: TimeseriesQueryInput;
  simpleMetrics?: MetricTranslation[];
  pipelineMetrics: MetricTranslation[];
  groupByColumn: string | null;
  groupByHandlesUnknown: boolean;
  joinClauses: string;
  baseWhere: string;
  filterWhere: string;
  filterParams: Record<string, unknown>;
  timeZone: string;
}): BuiltQuery {
  const ts = tableAliases.trace_summaries;
  const dateTrunc = getDateTruncFunction(input.timeScale as number, timeZone);

  const periodCase = `
    CASE
      WHEN ${ts}.OccurredAt >= {currentStart:DateTime64(3)} AND ${ts}.OccurredAt < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ts}.OccurredAt >= {previousStart:DateTime64(3)} AND ${ts}.OccurredAt < {previousEnd:DateTime64(3)} THEN 'previous'
    END`;

  const groupKeyExpr = groupByColumn
    ? groupByHandlesUnknown
      ? `${groupByColumn} AS group_key`
      : `if(${groupByColumn} IS NULL, 'unknown', toString(${groupByColumn})) AS group_key`
    : null;

  const fullFilterWhere = filterWhere;

  const groupKeyHaving = buildGroupKeyHavingClause({
    groupByColumn,
    groupByHandlesUnknown,
    groupBy: input.groupBy,
    groupByKey: input.groupByKey,
  });

  const ctes: string[] = pipelineMetrics.map((metric) =>
    buildPipelineMetricCTE(metric, {
      ts,
      periodCase,
      dateTrunc,
      groupByColumn,
      groupKeyExpr,
      groupKeyHaving,
      joinClauses,
      baseWhere,
      fullFilterWhere,
    }),
  );

  // Build a CTE for simple (non-pipeline) metrics so they are not dropped
  // when mixed with pipeline metrics on numeric timeScale.
  // Quote aliases that start with digits for ClickHouse compatibility.
  // Use only the joins required by simple metrics (+ groupBy + filters) to
  // avoid fan-out inflation from evaluation_runs or stored_spans joins that
  // are only needed by pipeline metrics.
  const hasSimple = simpleMetrics.length > 0;
  if (hasSimple) {
    const simpleSelectExprs = [
      `${periodCase} AS period`,
      `${dateTrunc} AS date`,
      ...(groupKeyExpr ? [groupKeyExpr] : []),
      ...simpleMetrics.map((m) => {
        const quotedAlias = quoteIdentifier(m.alias);
        return m.selectExpression.replace(
          ` AS ${m.alias}`,
          ` AS ${quotedAlias}`,
        );
      }),
    ];
    const simpleGroupByCols = ["period", "date"];
    if (groupByColumn) simpleGroupByCols.push("group_key");

    // Build minimal join clauses: only joins needed by simple metrics, the
    // groupBy column, and filters — not pipeline metrics.
    const simpleJoins = new Set<CHTable>();
    for (const m of simpleMetrics) {
      for (const j of m.requiredJoins) simpleJoins.add(j);
    }
    if (input.groupBy) {
      const gExpr = getGroupByExpression(input.groupBy, input.groupByKey);
      for (const j of gExpr.requiredJoins) simpleJoins.add(j);
    }
    // Include filter joins by re-translating (idempotent, no side effects
    // that affect query correctness — param names are already in filterParams)
    if (input.filters) {
      const filterJoins = translateAllFilters(input.filters).requiredJoins;
      for (const j of filterJoins) simpleJoins.add(j);
    }
    const allSimpleExprs = [
      ...simpleMetrics.map((m) => m.selectExpression),
      fullFilterWhere,
      groupByColumn ?? "",
    ];
    const simpleJoinClauses = Array.from(simpleJoins)
      .map((table) => {
        const requiredColumns = resolveRequiredColumns(table, allSimpleExprs);
        // Both-periods regime: bound the stored_spans / evaluation_runs JOINs
        // to the date envelope.
        return buildJoinClause({
          table,
          requiredColumns,
          spanTimeFilter: SPAN_TIME_FILTER_BOTH_PERIODS,
          evalTimeFilter: EVAL_TIME_FILTER_BOTH_PERIODS,
        });
      })
      .join("\n");

    ctes.push(`
      simple_metrics AS (
        SELECT
          ${simpleSelectExprs.join(",\n          ")}
        FROM ${dedupedTraceSummaries(ts)}
        ${simpleJoinClauses}
        WHERE ${baseWhere}
          ${fullFilterWhere}
        GROUP BY ${simpleGroupByCols.join(", ")}
        ${groupKeyHaving}
      )`);
  }

  // Build final SELECT — join all CTEs on (period, date[, group_key])
  const joinKeys = groupByColumn
    ? ["period", "date", "group_key"]
    : ["period", "date"];

  // Determine the anchor CTE (first source in the FROM/JOIN chain)
  const firstPipelineCteName = `cte_${pipelineMetrics[0]!.alias}`;
  const anchorCte = hasSimple ? "simple_metrics" : firstPipelineCteName;

  let finalSelect: string;
  if (!hasSimple && pipelineMetrics.length === 1) {
    // Single pipeline metric, no simple metrics — simple path
    finalSelect = `SELECT * FROM ${firstPipelineCteName} WHERE period IS NOT NULL ORDER BY period, date`;
  } else {
    // Multiple sources: FULL OUTER JOIN on (period, date[, group_key])
    let joinSql = anchorCte;
    const selectCols = [...joinKeys.map((k) => `${anchorCte}.${k}`)];

    // Add simple metric columns from anchor
    if (hasSimple) {
      for (const m of simpleMetrics) {
        selectCols.push(`${anchorCte}.${quoteIdentifier(m.alias)}`);
      }
    }

    // Determine which pipeline CTEs need joining (skip anchor if it's the first pipeline CTE)
    const pipelineCTEsToJoin = hasSimple
      ? pipelineMetrics
      : pipelineMetrics.slice(1);

    // If anchor is the first pipeline CTE, add its column
    if (!hasSimple) {
      selectCols.push(
        `${firstPipelineCteName}.${quoteIdentifier(pipelineMetrics[0]!.alias)}`,
      );
    }

    for (const metric of pipelineCTEsToJoin) {
      const cteName = `cte_${metric.alias}`;
      const onClause = joinKeys
        .map((k) => `${anchorCte}.${k} = ${cteName}.${k}`)
        .join(" AND ");
      joinSql += `\n    FULL OUTER JOIN ${cteName} ON ${onClause}`;
      selectCols.push(`${cteName}.${quoteIdentifier(metric.alias)}`);
    }

    finalSelect = `SELECT ${selectCols.join(", ")} FROM ${joinSql} WHERE ${anchorCte}.period IS NOT NULL ORDER BY ${anchorCte}.period, ${anchorCte}.date`;
  }

  const sql = `
    WITH
      ${ctes.join(",\n      ")}
    ${finalSelect}
  `;

  return {
    sql,
    params: {
      tenantId: input.projectId,
      currentStart: input.startDate,
      currentEnd: input.endDate,
      previousStart: input.previousPeriodStartDate,
      previousEnd: input.startDate,
      ...filterParams,
      ...(input.groupByKey ? { groupByKey: input.groupByKey } : {}),
    },
  };
}

/** Shared context for building a pipeline metric CTE */
interface PipelineCTEContext {
  ts: string;
  periodCase: string;
  dateTrunc: string;
  groupByColumn: string | null;
  groupKeyExpr: string | null;
  groupKeyHaving: string;
  joinClauses: string;
  baseWhere: string;
  fullFilterWhere: string;
}

/**
 * Build a single pipeline metric CTE with date bucketing.
 * Handles both standard 2-level and nested 3-level aggregations.
 */
function buildPipelineMetricCTE(
  metric: MetricTranslation,
  ctx: PipelineCTEContext,
): string {
  if (!metric.subquery) {
    throw new Error(`Metric "${metric.alias}" is missing subquery definition`);
  }
  const subquery = metric.subquery;
  const traceColumns = referencedTraceColumns(
    [metric],
    [ctx.fullFilterWhere, ctx.groupKeyExpr ?? "", ctx.joinClauses],
  );
  const cteName = `cte_${metric.alias}`;
  const hasGroup = !!ctx.groupByColumn;
  const groupPrefix = hasGroup ? "group_key, " : "";
  const quotedAlias = quoteIdentifier(metric.alias);

  // Outer aggregation expression (strip original alias, re-alias with quoting)
  const outerAggExpr = subquery.outerAggregation.replace(
    ` AS ${metric.alias}`,
    "",
  );

  // Outer GROUP BY / HAVING
  const outerGroupByCols = ["period", "date"];
  if (hasGroup) outerGroupByCols.push("group_key");
  const outerHaving = ctx.groupKeyHaving;

  // Inner select: the base scan with period/date bucketing
  const baseSelectCols = [
    `${ctx.periodCase} AS period`,
    `${ctx.dateTrunc} AS date`,
    ...(ctx.groupKeyExpr ? [ctx.groupKeyExpr] : []),
  ];

  const baseFrom = `
          FROM ${dedupedTraceSummaries(ctx.ts, traceColumns, DATE_FILTER_BOTH_PERIODS)}
          ${ctx.joinClauses}
          WHERE ${ctx.baseWhere}
            ${ctx.fullFilterWhere}`;

  if (subquery.nestedSubquery) {
    // 3-level aggregation (e.g., threads per user)
    const nested = subquery.nestedSubquery;
    const nestedHaving = nested.having ? `HAVING ${nested.having}` : "";

    const level2GroupByCols = ["period", "date"];
    if (hasGroup) level2GroupByCols.push("group_key");
    level2GroupByCols.push(subquery.innerGroupBy);

    return `
      ${cteName} AS (
        SELECT period, date, ${groupPrefix}${outerAggExpr} AS ${quotedAlias}
        FROM (
          SELECT period, date, ${groupPrefix}${subquery.innerSelect}
          FROM (
            SELECT
              ${baseSelectCols.join(",\n              ")},
              ${nested.select}
            ${baseFrom}
            GROUP BY period, date, ${groupPrefix}${nested.groupBy}
            ${nestedHaving}
          ) thread_data
          GROUP BY ${level2GroupByCols.join(", ")}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
        GROUP BY ${outerGroupByCols.join(", ")}
        ${outerHaving}
      )`;
  }

  // Standard 2-level aggregation
  const innerGroupByCols = ["period", "date"];
  if (hasGroup) innerGroupByCols.push("group_key");
  innerGroupByCols.push(subquery.innerGroupBy);

  return `
      ${cteName} AS (
        SELECT period, date, ${groupPrefix}${outerAggExpr} AS ${quotedAlias}
        FROM (
          SELECT
            ${baseSelectCols.join(",\n            ")},
            ${subquery.innerSelect}
          ${baseFrom}
          GROUP BY ${innerGroupByCols.join(", ")}
          HAVING ${subquery.innerGroupBy} IS NOT NULL AND toString(${subquery.innerGroupBy}) != ''
        ) sub
        GROUP BY ${outerGroupByCols.join(", ")}
        ${outerHaving}
      )`;
}

/**
 * Ordered (source expression -> CTE column) rewrites applied by
 * transformMetricForDedup. COMPOSITE expressions come first, longest first,
 * so a metric like total_tokens (prompt + completion) has EVERY term rewritten
 * against its CTE column, preserving the metric's arithmetic.
 *
 * The previous implementation replaced the whole aggregation argument with the
 * FIRST matching column, which silently collapsed composite metrics: grouped
 * total_tokens returned prompt_tokens only, grouped cost_billed returned the
 * un-subtracted total cost, and grouped cost_non_billed returned the total.
 *
 * `bare: true` entries are single column references rewritten with the
 * boundary-safe replaceColumnWithAlias; composite entries are exact literals
 * produced by the same string builders metric-translator uses, so plain
 * split/join substitution is safe.
 */
/**
 * Trace-level `Attributes` map reads a metric may aggregate over, and the CTE
 * column each is hoisted to.
 *
 * These are the metadata fields whose `fieldMappings` entry resolves to
 * `Attributes['…']` rather than to a typed column. A metric over one of them
 * (e.g. `metadata.thread_id / cardinality` →
 * `uniqIf(ts.Attributes['gen_ai.conversation.id'], …)`) is aggregated in the
 * OUTER query, which selects `FROM deduped_traces` and has no `ts` alias in
 * scope — so the read has to be hoisted into the CTE under a name, exactly as
 * the typed passthroughs (`ts.TotalCost AS trace_total_cost`) already are.
 *
 * Before this list existed only three hardcoded `langwatch.reserved.*` token
 * keys were hoisted, so every other Attributes-backed metric emitted a raw
 * `ts.Attributes[…]` into the outer SELECT and ClickHouse rejected the whole
 * query with "Unknown expression or function identifier `ts.Attributes`".
 * Observed in production 2026-08-10 on a thread-id count grouped by label.
 */
export const TRACE_ATTRIBUTE_METRIC_COLUMNS = [
  { attributeKey: "langwatch.user_id", cteColumn: "trace_attr_user_id" },
  { attributeKey: "gen_ai.conversation.id", cteColumn: "trace_attr_thread_id" },
  {
    attributeKey: "langwatch.customer_id",
    cteColumn: "trace_attr_customer_id",
  },
  { attributeKey: "langwatch.labels", cteColumn: "trace_attr_labels" },
  { attributeKey: "langwatch.prompt_ids", cteColumn: "trace_attr_prompt_ids" },
] as const;

/** The `ts.Attributes['<key>']` source expression for a hoisted attribute. */
function traceAttributeSource(attributeKey: string): string {
  return `${tableAliases.trace_summaries}.Attributes['${attributeKey}']`;
}

function dedupSubstitutions(): Array<{
  source: string;
  cteColumn: string;
  bare?: boolean;
}> {
  const ts = tableAliases.trace_summaries;
  return [
    // Attribute-map reads before the bare columns, for the same reason the
    // composites below come first: their source contains no bare column, but
    // keeping every map read ahead of the plain list makes the ordering rule
    // one rule ("longest / most specific first") rather than two.
    ...TRACE_ATTRIBUTE_METRIC_COLUMNS.map(({ attributeKey, cteColumn }) => ({
      source: traceAttributeSource(attributeKey),
      cteColumn,
    })),
    // Composites first: the non-billed fallback references TotalCost and
    // Attributes, and the cache/reasoning reads reference Attributes, so they
    // must be rewritten before the bare columns they contain.
    { source: nonBilledCostExpression(ts), cteColumn: "trace_non_billed_cost" },
    {
      source: `toUInt64OrZero(${ts}.Attributes['langwatch.reserved.cache_read_tokens'])`,
      cteColumn: "trace_cache_read_tokens",
    },
    {
      source: `toUInt64OrZero(${ts}.Attributes['langwatch.reserved.cache_creation_tokens'])`,
      cteColumn: "trace_cache_write_tokens",
    },
    {
      source: `toUInt64OrZero(${ts}.Attributes['langwatch.reserved.reasoning_tokens'])`,
      cteColumn: "trace_reasoning_tokens",
    },
    { source: `${ts}.TotalCost`, cteColumn: "trace_total_cost", bare: true },
    {
      source: `${ts}.NonBilledCost`,
      cteColumn: "trace_non_billed_cost",
      bare: true,
    },
    {
      source: `${ts}.TotalDurationMs`,
      cteColumn: "trace_duration_ms",
      bare: true,
    },
    {
      source: `${ts}.TotalPromptTokenCount`,
      cteColumn: "trace_prompt_tokens",
      bare: true,
    },
    {
      source: `${ts}.TotalCompletionTokenCount`,
      cteColumn: "trace_completion_tokens",
      bare: true,
    },
    {
      source: `${ts}.TokensPerSecond`,
      cteColumn: "trace_tokens_per_second",
      bare: true,
    },
    {
      source: `${ts}.TimeToFirstTokenMs`,
      cteColumn: "trace_time_to_first_token_ms",
      bare: true,
    },
  ];
}

/**
 * Map an evaluation metric's conditional aggregation (e.g. `avgIf`, `sumIf`)
 * to the cross-trace aggregation used in the outer query.
 *
 * Context: when evaluation metrics are pre-aggregated per trace inside a CTE
 * (to avoid inflating trace-level metrics via eval-run fan-out), the outer
 * query has a scalar per-trace value and must re-aggregate across traces.
 * This helper picks the correct aggregation based on the original conditional
 * aggregation, so semantics remain as close as possible to the pre-fix query.
 *
 * Returns `null` if no known aggregation is found (caller should fall back
 * to `avg` as a safe default for rates/averages).
 */
function mapEvalAggregationToOuter(selectExpression: string): string | null {
  const mappings: Array<{ pattern: RegExp; outer: string }> = [
    { pattern: /\bavgIf\s*\(/, outer: "avg" },
    { pattern: /\bsumIf\s*\(/, outer: "sum" },
    { pattern: /\bminIf\s*\(/, outer: "min" },
    { pattern: /\bmaxIf\s*\(/, outer: "max" },
    // uniqIf -> sum: per-trace `uniqIf(EvaluationId, ...)` produces a per-trace
    // count of unique evaluation runs, and summing across traces is correct
    // because EvaluationId is a primary key per evaluation run and each run
    // belongs to exactly one trace. If that 1:1 invariant ever changes,
    // summing would overcount and this mapping must be revisited.
    { pattern: /\buniqIf\s*\(/, outer: "sum" },
    { pattern: /\bcountIf\s*\(/, outer: "sum" },
    { pattern: /\bquantileExactIf\s*\(/, outer: "avg" },
  ];
  for (const { pattern, outer } of mappings) {
    if (pattern.test(selectExpression)) return outer;
  }
  return null;
}

/**
 * Strip the trailing ` AS <alias>` from a SELECT expression, returning just
 * the underlying aggregation expression. Used when we need to re-alias the
 * expression as a per-trace column (e.g. `<alias>__per_trace`).
 */
function stripSelectExpressionAlias(
  selectExpression: string,
  alias: string,
): string {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return selectExpression
    .replace(new RegExp(`\\s+AS\\s+${escaped}\\s*$`), "")
    .trim();
}

/**
 * Transform a metric expression to work with deduplicated trace data, and
 * refuse to emit one that would reference the `ts` alias outside the CTE.
 *
 * The guard wraps EVERY path on purpose. It used to sit inside the
 * substitution branch, so it only ran when at least one rewrite had already
 * matched — and the expression that actually reaches production unrewritten is
 * precisely the one no substitution matches. `metadata.thread_id / cardinality`
 * (`uniqIf(ts.Attributes['gen_ai.conversation.id'], …)`) matched nothing, fell
 * through to "return as-is", and shipped `ts.Attributes[…]` into an outer
 * SELECT whose only source is `deduped_traces`. ClickHouse then rejected the
 * whole query with "Unknown expression or function identifier `ts.Attributes`"
 * — a customer-visible analytics failure that the guard existed to prevent and
 * could not, because the guard's own precondition excluded the failing case.
 *
 * The outer query reads `FROM deduped_traces`, which has no `ts` alias in
 * scope, so ANY surviving `ts.` reference is invalid SQL. Throwing here turns a
 * ClickHouse error nobody can act on into one that names the fix.
 */
function transformMetricForDedup(
  selectExpression: string,
  alias: string,
): string {
  const rewritten = rewriteMetricForDedup(selectExpression, alias);
  const ts = tableAliases.trace_summaries;
  if (new RegExp(`(?<![\\w.])${ts}\\.`).test(rewritten)) {
    throw new Error(
      `transformMetricForDedup could not fully rewrite "${selectExpression}" for the grouped CTE. ` +
        `Add the missing trace-level column to the arrayJoin CTE select list and dedupSubstitutions in aggregation-builder.ts.`,
    );
  }
  return rewritten;
}

/**
 * The rewrite itself. count() becomes uniqExact(trace_id) to count distinct
 * traces. Trace-level column references are rewritten to their CTE columns,
 * keeping the metric's aggregation AND its arithmetic intact: a composite
 * metric like total_tokens (prompt + completion) keeps both terms.
 */
function rewriteMetricForDedup(
  selectExpression: string,
  alias: string,
): string {
  // Handle count() -> uniqExact(trace_id)
  if (/\bcount\s*\(\s*\*?\s*\)/.test(selectExpression)) {
    return `uniqExact(trace_id) AS ${alias}`;
  }

  // Handle uniq/uniqExact of TraceId -> uniqExact(trace_id)
  if (
    (/\buniq\s*\(/.test(selectExpression) ||
      /\buniqExact\s*\(/.test(selectExpression)) &&
    selectExpression.includes("TraceId")
  ) {
    return `uniqExact(trace_id) AS ${alias}`;
  }

  // Rewrite every known trace-level reference to its CTE column. Composite
  // sources are substituted before the bare columns they contain (see
  // dedupSubstitutions). @regression: the previous first-match logic dropped
  // all but one term of composite metrics (total_tokens == prompt_tokens).
  let rewritten = selectExpression;
  for (const { source, cteColumn, bare } of dedupSubstitutions()) {
    if (!rewritten.includes(source)) continue;
    rewritten = bare
      ? replaceColumnWithAlias(rewritten, source, cteColumn)
      : rewritten.split(source).join(cteColumn);
  }
  // The caller ({@link transformMetricForDedup}) enforces that nothing leaves
  // here still referencing `ts`, on this path and on every other one.
  if (rewritten !== selectExpression) {
    return rewritten;
  }

  // Handle evaluation metrics that reference evaluation_runs columns (es.Passed, es.Score, etc.)
  // Replace table-qualified references with CTE column aliases so the outer SELECT is valid.
  // Uses the same extractReferencedEvaluationColumns as the CTE projection to stay in sync.
  const es = tableAliases.evaluation_runs;
  const referencedEvalCols = extractReferencedEvaluationColumns([
    selectExpression,
  ]);
  if (referencedEvalCols.size > 0) {
    let rewritten = selectExpression;
    for (const col of referencedEvalCols) {
      rewritten = rewritten.replaceAll(
        `${es}.${col}`,
        `eval_${snakeCase(col)}`,
      );
    }
    return rewritten;
  }

  // Handle event-based metrics that reference stored_spans columns (ss."Events.Name", etc.)
  // In the CTE context with arrayJoin grouping, the group_key already filters to matching events.
  // Only rewrite count-like metrics — their semantics map to uniqExact(trace_id)
  // in the CTE context where group_key already filters to matching events.
  // Value-based aggregations (avgArray, sumArray, etc.) pass through unchanged
  // because rewriting them would silently change "average score" to "count of traces".
  const ss = tableAliases.stored_spans;
  if (
    selectExpression.includes(`${ss}."Events.Name"`) ||
    selectExpression.includes(`${ss}."Events.Attributes"`)
  ) {
    if (
      /\bcountIf\s*\(/.test(selectExpression) ||
      /\bcount\s*\(/.test(selectExpression) ||
      /\buniq/.test(selectExpression)
    ) {
      return `uniqExact(trace_id) AS ${alias}`;
    }
  }

  // Default: return as-is (may need extension for other metric types)
  return selectExpression;
}

/**
 * Build a query for dataForFilter (dropdown data)
 */
export function buildDataForFilterQuery(
  projectId: string,
  field: FilterField,
  startDate: Date,
  endDate: Date,
  key?: string,
  subkey?: string,
  searchQuery?: string,
  filters?: Partial<
    Record<
      FilterField,
      | string[]
      | Record<string, string[]>
      | Record<string, Record<string, string[]>>
    >
  >,
): BuiltQuery {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;
  const es = tableAliases.evaluation_runs;

  // Translate filters if provided
  const filterTranslation = translateAllFilters(
    filters ?? {},
    SPAN_TIME_FILTER_START_END,
  );
  const filterWhere =
    filterTranslation.whereClause !== "1=1"
      ? `AND ${filterTranslation.whereClause}`
      : "";
  const filterExpressions = [filterTranslation.whereClause];
  const filterJoins = Array.from(filterTranslation.requiredJoins)
    .map((table) => {
      const requiredColumns = resolveRequiredColumns(table, filterExpressions);
      // Start/end regime: bound the stored_spans / evaluation_runs JOINs to
      // the date envelope.
      return buildJoinClause({
        table,
        requiredColumns,
        spanTimeFilter: SPAN_TIME_FILTER_START_END,
        evalTimeFilter: EVAL_TIME_FILTER_START_END,
      });
    })
    .join("\n");

  let sql: string;
  let joins = "";

  // Build query based on field type
  switch (field) {
    case "topics.topics":
      sql = `
        SELECT
          ${ts}.TopicId AS field,
          ${ts}.TopicId AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts, undefined, DATE_FILTER_START_END)}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          AND ${ts}.TopicId IS NOT NULL
          AND ${ts}.TopicId != ''
          ${filterWhere}
          ${searchQuery ? `AND ${ts}.TopicId ILIKE {searchQuery:String}` : ""}
        GROUP BY ${ts}.TopicId
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "topics.subtopics":
      sql = `
        SELECT
          ${ts}.SubTopicId AS field,
          ${ts}.SubTopicId AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts, undefined, DATE_FILTER_START_END)}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          AND ${ts}.SubTopicId IS NOT NULL
          AND ${ts}.SubTopicId != ''
          ${filterWhere}
          ${searchQuery ? `AND ${ts}.SubTopicId ILIKE {searchQuery:String}` : ""}
        GROUP BY ${ts}.SubTopicId
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "metadata.user_id":
      sql = `
        SELECT
          ${ts}.Attributes['langwatch.user_id'] AS field,
          ${ts}.Attributes['langwatch.user_id'] AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts, undefined, DATE_FILTER_START_END)}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          AND ${ts}.Attributes['langwatch.user_id'] != ''
          ${filterWhere}
          ${searchQuery ? `AND ${ts}.Attributes['langwatch.user_id'] ILIKE {searchQuery:String}` : ""}
        GROUP BY field
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "metadata.thread_id":
      sql = `
        SELECT
          ${ts}.Attributes['gen_ai.conversation.id'] AS field,
          ${ts}.Attributes['gen_ai.conversation.id'] AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts, undefined, DATE_FILTER_START_END)}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          AND ${ts}.Attributes['gen_ai.conversation.id'] != ''
          ${filterWhere}
          ${searchQuery ? `AND ${ts}.Attributes['gen_ai.conversation.id'] ILIKE {searchQuery:String}` : ""}
        GROUP BY field
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "spans.model":
      joins = buildJoinClause({
        table: "stored_spans",
        requiredColumns: new Set(["SpanAttributes"]),
        spanTimeFilter: SPAN_TIME_FILTER_START_END,
      });
      sql = `
        SELECT
          ${ss}.SpanAttributes['gen_ai.request.model'] AS field,
          ${ss}.SpanAttributes['gen_ai.request.model'] AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts, undefined, DATE_FILTER_START_END)}
        ${joins}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          AND ${ss}.SpanAttributes['gen_ai.request.model'] != ''
          ${filterWhere}
          ${searchQuery ? `AND ${ss}.SpanAttributes['gen_ai.request.model'] ILIKE {searchQuery:String}` : ""}
        GROUP BY field
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "spans.type":
      joins = buildJoinClause({
        table: "stored_spans",
        requiredColumns: new Set(["SpanAttributes"]),
        spanTimeFilter: SPAN_TIME_FILTER_START_END,
      });
      sql = `
        SELECT
          ${ss}.SpanAttributes['langwatch.span.type'] AS field,
          ${ss}.SpanAttributes['langwatch.span.type'] AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts, undefined, DATE_FILTER_START_END)}
        ${joins}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          AND ${ss}.SpanAttributes['langwatch.span.type'] != ''
          ${filterWhere}
          ${searchQuery ? `AND ${ss}.SpanAttributes['langwatch.span.type'] ILIKE {searchQuery:String}` : ""}
        GROUP BY field
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "evaluations.evaluator_id":
    case "evaluations.evaluator_id.guardrails_only":
      joins = buildJoinClause({
        table: "evaluation_runs",
        evalTimeFilter: EVAL_TIME_FILTER_START_END,
      });
      sql = `
        SELECT
          ${es}.EvaluatorId AS field,
          concat('[', coalesce(${es}.EvaluatorName, ${es}.EvaluatorType, 'custom'), '] ', coalesce(${es}.EvaluatorName, '')) AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts, undefined, DATE_FILTER_START_END)}
        ${joins}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          ${field === "evaluations.evaluator_id.guardrails_only" ? `AND ${es}.IsGuardrail = 1` : ""}
          ${filterWhere}
          ${searchQuery ? `AND ${es}.EvaluatorName ILIKE {searchQuery:String}` : ""}
        GROUP BY ${es}.EvaluatorId, ${es}.EvaluatorName, ${es}.EvaluatorType
        ORDER BY count DESC
        LIMIT ${MAX_FILTER_OPTIONS}
      `;
      break;

    case "traces.error":
      sql = `
        SELECT
          if(toUInt8(coalesce(${ts}.ContainsErrorStatus, 0)) = 1, 'true', 'false') AS field,
          if(toUInt8(coalesce(${ts}.ContainsErrorStatus, 0)) = 1, 'Traces with error', 'Traces without error') AS label,
          count() AS count
        FROM ${dedupedTraceSummaries(ts, undefined, DATE_FILTER_START_END)}
        ${filterJoins}
        WHERE ${ts}.TenantId = {tenantId:String}
          AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
          AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
          ${filterWhere}
        GROUP BY toUInt8(coalesce(${ts}.ContainsErrorStatus, 0))
        ORDER BY count DESC
      `;
      break;

    default:
      // Fallback: return empty result
      sql = `SELECT '' AS field, '' AS label, 0 AS count WHERE 1=0`;
  }

  return {
    sql,
    params: {
      tenantId: projectId,
      startDate,
      endDate,
      searchQuery: searchQuery ? `%${searchQuery}%` : undefined,
      ...filterTranslation.params,
    },
  };
}

/**
 * Build a query for top used documents (RAG analytics)
 */
export function buildTopDocumentsQuery(
  projectId: string,
  startDate: Date,
  endDate: Date,
  filters?: Partial<
    Record<
      FilterField,
      | string[]
      | Record<string, string[]>
      | Record<string, Record<string, string[]>>
    >
  >,
): BuiltQuery {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  // Translate filters
  const filterTranslation = translateAllFilters(
    filters ?? {},
    SPAN_TIME_FILTER_START_END,
  );
  const filterWhere =
    filterTranslation.whereClause !== "1=1"
      ? `AND ${filterTranslation.whereClause}`
      : "";

  // Build query to get top documents from RAG contexts
  // Documents are stored in SpanAttributes['langwatch.rag.contexts'] as JSON.
  // The document payload comes entirely from the stored_spans ARRAY JOIN; the
  // fixed part of this query only uses trace_summaries identity/date columns
  // (the JOIN keys and the OccurredAt filter). So the deduped subquery reads
  // just the identity columns plus whatever the user filters reference, instead
  // of the full analytics set, which avoids materialising the heavy Attributes
  // map for every deduped trace.
  const traceColumns = Array.from(
    new Set([
      ...TRACE_IDENTITY_COLUMNS,
      ...extractReferencedTraceColumns([filterWhere]),
    ]),
  );

  const sql = `
    WITH document_refs AS (
      SELECT
        ${ts}.TraceId,
        toString(context.document_id) AS document_id,
        toString(context.content) AS content
      FROM ${dedupedTraceSummaries(ts, traceColumns, DATE_FILTER_START_END)}
      JOIN stored_spans ${ss} ON ${ts}.TenantId = ${ss}.TenantId AND ${ts}.TraceId = ${ss}.TraceId
      ARRAY JOIN JSONExtract(${ss}.SpanAttributes['langwatch.rag.contexts'], 'Array(JSON)') AS context
      WHERE ${ts}.TenantId = {tenantId:String}
        AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
        AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
        AND ${ss}.StartTime >= {startDate:DateTime64(3)} - INTERVAL 2 DAY
        AND ${ss}.StartTime < {endDate:DateTime64(3)} + INTERVAL 2 DAY
        AND ${ss}.SpanAttributes['langwatch.rag.contexts'] != ''
        ${filterWhere}
    )
    SELECT
      document_id AS documentId,
      count() AS count,
      any(TraceId) AS traceId,
      any(content) AS content
    FROM document_refs
    WHERE document_id != ''
    GROUP BY document_id
    ORDER BY count DESC
    LIMIT 10
  `;

  const totalSql = `
    SELECT uniq(toString(context.document_id)) AS total
    FROM ${dedupedTraceSummaries(ts, traceColumns, DATE_FILTER_START_END)}
    JOIN stored_spans ${ss} ON ${ts}.TenantId = ${ss}.TenantId AND ${ts}.TraceId = ${ss}.TraceId
    ARRAY JOIN JSONExtract(${ss}.SpanAttributes['langwatch.rag.contexts'], 'Array(JSON)') AS context
    WHERE ${ts}.TenantId = {tenantId:String}
      AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
      AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
      AND ${ss}.StartTime >= {startDate:DateTime64(3)} - INTERVAL 2 DAY
      AND ${ss}.StartTime < {endDate:DateTime64(3)} + INTERVAL 2 DAY
      AND ${ss}.SpanAttributes['langwatch.rag.contexts'] != ''
      ${filterWhere}
  `;

  return {
    sql: `${sql}; ${totalSql}`,
    params: {
      tenantId: projectId,
      startDate,
      endDate,
      ...filterTranslation.params,
    },
  };
}

/**
 * Build a query for feedbacks
 */
export function buildFeedbacksQuery(
  projectId: string,
  startDate: Date,
  endDate: Date,
  filters?: Partial<
    Record<
      FilterField,
      | string[]
      | Record<string, string[]>
      | Record<string, Record<string, string[]>>
    >
  >,
): BuiltQuery {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  // Translate filters
  const filterTranslation = translateAllFilters(
    filters ?? {},
    SPAN_TIME_FILTER_START_END,
  );
  const filterWhere =
    filterTranslation.whereClause !== "1=1"
      ? `AND ${filterTranslation.whereClause}`
      : "";

  // Build query to get feedback events
  // Events are stored in stored_spans as parallel arrays. As with the documents
  // query, the fixed part uses only trace_summaries identity/date columns, so
  // the deduped subquery reads just the identity columns plus whatever the user
  // filters reference rather than the full analytics set, skipping the heavy
  // Attributes map.
  const traceColumns = Array.from(
    new Set([
      ...TRACE_IDENTITY_COLUMNS,
      ...extractReferencedTraceColumns([filterWhere]),
    ]),
  );

  const sql = `
    SELECT
      ${ts}.TraceId AS trace_id,
      ${ss}.SpanId AS event_id,
      toUnixTimestamp64Milli(event_timestamp) AS started_at,
      event_name AS event_type,
      event_attrs AS attributes
    FROM ${dedupedTraceSummaries(ts, traceColumns, DATE_FILTER_START_END)}
    JOIN stored_spans ${ss} ON ${ts}.TenantId = ${ss}.TenantId AND ${ts}.TraceId = ${ss}.TraceId
    ARRAY JOIN
      ${ss}."Events.Timestamp" AS event_timestamp,
      ${ss}."Events.Name" AS event_name,
      ${ss}."Events.Attributes" AS event_attrs
    WHERE ${ts}.TenantId = {tenantId:String}
      AND ${ts}.OccurredAt >= {startDate:DateTime64(3)}
      AND ${ts}.OccurredAt < {endDate:DateTime64(3)}
      AND ${ss}.StartTime >= {startDate:DateTime64(3)} - INTERVAL 2 DAY
      AND ${ss}.StartTime < {endDate:DateTime64(3)} + INTERVAL 2 DAY
      AND event_name = 'thumbs_up_down'
      AND mapContains(event_attrs, 'event.metrics.vote')
      ${filterWhere}
    ORDER BY event_timestamp DESC
    LIMIT 100
  `;

  return {
    sql,
    params: {
      tenantId: projectId,
      startDate,
      endDate,
      ...filterTranslation.params,
    },
  };
}

// Exported for test coverage — do not use outside tests.
export const __testOnly__ = {
  mapEvalAggregationToOuter,
  extractTraceAggregationColumn,
  replaceColumnWithAlias,
  hasEvalMixedWithTraceMetrics,
  transformMetricForDedup,
  dedupSubstitutions,
};
