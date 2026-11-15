/**
 * Slim read of `trace_analytics` (ADR-034 Phase 3), deliberately separate from the legacy
 * `aggregation-builder.ts` (trace_summaries), on the typed builder (ADR-202). Follows
 * clickhouse-queries.md's tenant, partition and dedup rules; throws on unsupported shapes.
 */

import type { AnalyticsFilterValue } from "@langwatch/analytics-contract";
import {
  clickhouseRead,
  column,
  type Condition,
  cond,
  type Expression,
  fn,
  param,
  type ReaderReadStatement,
} from "@langwatch/clickhouse-client/builder";

import type { TimeseriesQueryInput } from "./clickhouse.aggregation-builder.mapper.ts";
import {
  isSlimEligibleTraceMetricKey,
  type SlimTraceMetricKey,
} from "./clickhouse.analytics-route-table.mapper.ts";
import { storedMetadataKeys } from "./clickhouse.filter-conditions.mapper.ts";
import { buildMetricAlias } from "./clickhouse.metric-translator.mapper.ts";
import {
  allOf,
  anyOf,
  collectStringValues,
  dateBucket,
  groupKeyOf,
  hasFilterValues,
  inEitherPeriod,
  type Measure,
  periodOf,
  slimAggregate,
  type TimeseriesRead,
} from "./clickhouse.timeseries-query-shared.mapper.ts";
import { traceAnalytics as ta } from "./clickhouse.trace-analytics.table.ts";

/**
 * Group-by keys the slim builder serves. `metadata.model` is deliberately
 * NOT here: model group-bys need per-SPAN attribution slim has no data for;
 * the router sends them to `trace_summaries` (see route-table.ts).
 */
type SlimGroupByKey =
  | "error.has_error"
  | "topics.topics"
  | "traces.trace_name"
  | "metadata.user_id"
  | "metadata.thread_id"
  | "metadata.customer_id"
  | "metadata.labels";

function isSlimGroupByKey(groupBy: string): groupBy is SlimGroupByKey {
  switch (groupBy) {
    case "error.has_error":
    case "topics.topics":
    case "traces.trace_name":
    case "metadata.user_id":
    case "metadata.thread_id":
    case "metadata.customer_id":
    case "metadata.labels":
      return true;
    default:
      return false;
  }
}

/**
 * Group-bys whose expression resolves empty/NULL to an explicit `'unknown'`
 * bucket rather than `''`, mirroring legacy's `handlesUnknown: true` fields —
 * like legacy, these must NOT get a `HAVING group_key != ''` clause.
 */
function slimGroupByHandlesUnknown(groupBy?: string): boolean {
  return groupBy === "traces.trace_name" || groupBy === "error.has_error";
}

/** The columns a deduped trace may carry; a read carries only those its series name. */
const CARRIED = [
  "OccurredAt",
  "UserId",
  "ConversationId",
  "CustomerId",
  "TotalCost",
  "NonBilledCost",
  "TotalDurationMs",
  "TimeToFirstTokenMs",
  "PromptTokens",
  "CompletionTokens",
  "CacheReadTokens",
  "CacheWriteTokens",
  "ReasoningTokens",
  "TokensPerSecond",
  "HasError",
  "TopicId",
  "TraceName",
  "Labels",
] as const;
type Carried = (typeof CARRIED)[number];

/** The carried tuple, indexed by position. */
type CarriedRow = readonly unknown[] & { readonly [position: `${number}`]: unknown };

/** One trace's newest value of a carried column, and its keys. */
type LatestTrace<T extends string> = {
  carried: (name: Carried) => Measure<T>;
  tenantId: Measure<T>;
  traceId: Measure<T>;
};

type Slim = Measure<"trace_analytics">;
type SlimCondition = Condition<"trace_analytics">;

/** Keyed by member: two members of a group project can hold the same id. */
const memberScopedId = <T extends string>(tenantId: Measure<T>, id: Measure<T>): Measure<T> =>
  fn.if(cond.eq(id, param.string("")), param.string(""), fn.concat(tenantId, "/", id));

/** A registry metric's column on the newest version of a trace. */
function slimColumnFor<T extends string>(
  metric: SlimTraceMetricKey,
  { carried, tenantId, traceId }: LatestTrace<T>,
): Measure<T> {
  const zero = param.uint32(0);
  switch (metric) {
    case "metadata.trace_id":
      return traceId;
    case "metadata.user_id":
      return memberScopedId(tenantId, carried("UserId"));
    case "metadata.thread_id":
      return memberScopedId(tenantId, carried("ConversationId"));
    case "performance.total_cost":
      return carried("TotalCost");
    case "performance.cost_non_billed":
      return fn.coalesce(carried("NonBilledCost"), param.float64(0));
    case "performance.cost_billed":
      return fn.minus(
        fn.coalesce(carried("TotalCost"), param.float64(0)),
        fn.coalesce(carried("NonBilledCost"), param.float64(0)),
      );
    case "performance.completion_time":
      return carried("TotalDurationMs");
    case "performance.first_token":
      return carried("TimeToFirstTokenMs");
    case "performance.prompt_tokens":
      return carried("PromptTokens");
    case "performance.completion_tokens":
      return carried("CompletionTokens");
    case "performance.cache_read_tokens":
      return carried("CacheReadTokens");
    case "performance.cache_write_tokens":
      return carried("CacheWriteTokens");
    case "performance.reasoning_tokens":
      return carried("ReasoningTokens");
    // The rollup's four typed columns, not the Attributes-map mirror the trim service may drop.
    case "performance.total_tokens":
    case "performance.total_processed_tokens":
      return fn.plus(
        fn.plus(
          fn.coalesce(carried("PromptTokens"), zero),
          fn.coalesce(carried("CompletionTokens"), zero),
        ),
        fn.plus(
          fn.coalesce(carried("CacheReadTokens"), zero),
          fn.coalesce(carried("CacheWriteTokens"), zero),
        ),
      );
    case "performance.tokens_per_second":
      return carried("TokensPerSecond");
    default: {
      const _exhaustive: never = metric;
      throw new Error(
        `Slim builder cannot serve metric "${String(_exhaustive)}". The router should have routed this to trace_summaries.`,
      );
    }
  }
}

/** Slim group-by expressions: typed columns and the labels array. */
function slimGroupings<T extends string>(
  groupBy: string | undefined,
  latest: LatestTrace<T>,
): Measure<T>[] {
  return groupBy ? [slimGroupByExpression(groupBy, latest)] : [];
}

function slimGroupByExpression<T extends string>(
  groupBy: string,
  { carried }: LatestTrace<T>,
): Measure<T> {
  if (!isSlimGroupByKey(groupBy)) {
    throw new Error(`Slim builder cannot group by "${groupBy}".`);
  }
  switch (groupBy) {
    case "error.has_error":
      // Same labels as the legacy builder's `ContainsErrorStatus` bucket.
      return fn.if(
        carried("HasError") as Condition<T>,
        param.string("with error"),
        param.string("without error"),
      );
    case "topics.topics":
      return carried("TopicId");
    case "traces.trace_name": {
      const name = carried("TraceName");
      return fn.if(cond.eq(name, param.string("")), param.string("unknown"), name);
    }
    case "metadata.user_id":
      return carried("UserId");
    case "metadata.thread_id":
      return carried("ConversationId");
    case "metadata.customer_id":
      return carried("CustomerId");
    case "metadata.labels": {
      // One row per label; a trace with none counts once under ''.
      const labels = carried("Labels");
      return fn.arrayJoin(fn.if(fn.empty(labels), param.strings([""]), labels));
    }
    default: {
      const _exhaustive: never = groupBy;
      throw new Error(`Unhandled slim group-by: ${String(_exhaustive)}`);
    }
  }
}

/** A row with signal: dimension-only rows (no span, no log record) are not a trace. */
const HAS_SIGNAL: SlimCondition = cond.or(
  cond.gt(ta.SpanCount, 0),
  cond.gt(ta.EarliestSpanStartMs, 0),
  cond.not(cond.oneOf(fn.mapGet(ta.Attributes, "langwatch.reserved.log_record_count"), ["", "0"])),
  cond.lt(ta.Version, "2026-07-27"),
);

/** Custom metadata stored under any of its three keys, with a value. */
const metadataPresent = (key: string): SlimCondition =>
  anyOf(
    storedMetadataKeys(key).map((stored) =>
      cond.and(
        fn.mapContains(ta.Attributes, stored),
        cond.ne(fn.mapGet(ta.Attributes, stored), ""),
      ),
    ),
  );

/**
 * The filter fields slim serves natively, as conditions on a raw row; any other field throws as
 * a guardrail (`pickAnalyticsTable` has rejected it already).
 */
function slimFilterTerms(field: string, rawValue: AnalyticsFilterValue): SlimCondition[] {
  const values = collectStringValues(rawValue);
  switch (field) {
    case "topics.topics":
      return [cond.oneOf(ta.TopicId, values)];
    case "topics.subtopics":
      return [cond.oneOf(ta.SubTopicId, values)];
    case "metadata.user_id":
      return [cond.oneOf(ta.UserId, values)];
    case "metadata.thread_id":
      return [cond.oneOf(ta.ConversationId, values)];
    case "metadata.customer_id":
      return [cond.oneOf(ta.CustomerId, values)];
    case "metadata.labels":
      return [fn.hasAny(ta.Labels, values)];
    case "metadata.prompt_ids":
      // A JSON string under the reserved key the trim keeps.
      return [
        fn.hasAny(
          fn.JSONExtract(
            fn.mapGet(ta.Attributes, "langwatch.prompt_ids"),
            column.array(column.string()),
          ),
          values,
        ),
      ];
    case "traces.origin":
      return [cond.oneOf(ta.Origin, values)];
    case "traces.error": {
      // ES sends "true"/"false"; both, or neither, filter nothing.
      const wantsErrors = values.includes("true");
      const wantsClean = values.includes("false");
      if (wantsErrors === wantsClean) return [];
      return [cond.eq(ta.HasError, wantsErrors)];
    }
    case "traces.name":
      return [cond.oneOf(ta.TraceName, values)];
    case "metadata.key":
      return values.length > 0 ? [anyOf(values.map(metadataPresent))] : [];
    case "metadata.value": {
      // Values with no key match nothing, as on trace_summaries.
      if (Array.isArray(rawValue)) return [cond.never()];
      if (typeof rawValue !== "object") return [];
      const terms = Object.entries(rawValue)
        .filter(
          (entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].length > 0,
        )
        .map(([key, keyValues]) =>
          anyOf(
            storedMetadataKeys(key).map((stored) =>
              cond.oneOf(fn.mapGet(ta.Attributes, stored), keyValues),
            ),
          ),
        );
      return terms.length > 0 ? [allOf(terms)] : [];
    }
    default:
      throw new Error(
        `Slim builder cannot serve filter "${field}". The router should have routed this to trace_summaries.`,
      );
  }
}

/**
 * The dashboard's filters and the caller's own origin exclusion, ANDed. The exclusion is not one
 * of the filters: a negated filter selection never inverts it.
 */
function slimMatchTerms(input: TimeseriesQueryInput): SlimCondition[] {
  const terms: SlimCondition[] = [];
  for (const [field, rawValue] of Object.entries(input.filters ?? {})) {
    if (!hasFilterValues(rawValue)) continue;
    terms.push(...slimFilterTerms(field, rawValue));
  }
  if (input.excludeOrigins && input.excludeOrigins.length > 0) {
    terms.push(cond.not(cond.oneOf(ta.Origin, input.excludeOrigins)));
  }
  return terms;
}

/** The series and the group key over one trace's newest version. */
function slimShape<T extends string>(
  input: TimeseriesQueryInput,
  latest: LatestTrace<T>,
): { metrics: Record<string, Measure<T>>; groupKey: Measure<T> | undefined } {
  const [grouping] = slimGroupings(input.groupBy, latest);
  const metrics: Record<string, Measure<T>> = {};
  input.series.forEach((s, i) => {
    if (!isSlimEligibleTraceMetricKey(s.metric)) {
      throw new Error(
        `Slim builder cannot serve metric "${s.metric}". The router should have routed this to trace_summaries.`,
      );
    }
    const alias = buildMetricAlias({
      index: i,
      metric: s.metric,
      aggregation: s.aggregation,
      key: s.key,
      subkey: s.subkey,
    });
    metrics[alias] = slimAggregate({
      aggregation: s.aggregation,
      of: slimColumnFor(s.metric, latest),
      table: "slim",
    });
  });
  return { metrics, groupKey: grouping ? groupKeyOf(grouping) : undefined };
}

/**
 * The slim read of `trace_analytics`. Each trace's newest version in range is collapsed with a
 * spillable `argMax` of a tuple (a NULL survives it) under the proof's windows on `OccurredAt`;
 * the tuple also carries whether the row has signal and matches the filters, as of that version.
 */
export function slimTimeseriesRead({
  scope,
  input,
  settings,
}: TimeseriesRead): ReaderReadStatement {
  const used = new Set<Carried>(["OccurredAt"]);
  slimShape(input, {
    carried: (name) => {
      used.add(name);
      return ta[name];
    },
    tenantId: ta.TenantId,
    traceId: ta.TraceId,
  });
  const carried = CARRIED.filter((name) => used.has(name));
  const matchTerms = slimMatchTerms(input);
  const matches = matchTerms.length > 0 ? allOf(matchTerms) : undefined;

  const versions = clickhouseRead({ scope })
    .from(ta)
    .withinWindows()
    .select({
      TenantId: ta.TenantId,
      TraceId: ta.TraceId,
      __version: ta.UpdatedAt,
      __latest_row: fn.tuple(
        ...carried.map((name): Slim => ta[name]),
        HAS_SIGNAL,
        ...(matches ? [matches] : []),
      ),
    })
    .where(() => inEitherPeriod(ta.OccurredAt, input))
    .as("versions");
  const latest = clickhouseRead({ scope })
    .from(versions)
    .select({
      TenantId: versions.TenantId,
      TraceId: versions.TraceId,
      __latest: fn.argMax(versions.__latest_row, versions.__version),
    })
    .groupBy(versions.TenantId, versions.TraceId)
    .as("ta");
  const row = latest.__latest as Expression<CarriedRow, "ta">;
  const at = (position: number): Measure<"ta"> => fn.tupleElement(row, `${position}`);
  const newest: LatestTrace<"ta"> = {
    carried: (name) => at(carried.indexOf(name)),
    tenantId: latest.TenantId,
    traceId: latest.TraceId,
  };
  const { metrics, groupKey } = slimShape(input, newest);
  const occurredAt = newest.carried("OccurredAt");
  const period = periodOf(occurredAt, input);
  const date =
    typeof input.timeScale === "number"
      ? dateBucket(occurredAt, input.timeScale, input.timeZone ?? "UTC")
      : undefined;

  const selection: Record<string, Measure<"ta">> = { period };
  if (date) selection.date = date;
  if (groupKey) selection.group_key = groupKey;
  Object.assign(selection, metrics);

  const kept: Condition<"ta">[] = [inEitherPeriod(occurredAt, input), at(carried.length)];
  if (matches) kept.push(at(carried.length + 1));
  const keys = [period, ...(date ? [date] : []), ...(groupKey ? [groupKey] : [])];
  const grouped = clickhouseRead({ scope })
    .from(latest)
    .select(selection)
    .where(() => allOf(kept))
    .groupBy(...keys);
  // A group-by that folds empty into 'unknown' keeps that bucket, as legacy's `handlesUnknown`.
  const having =
    groupKey && !slimGroupByHandlesUnknown(input.groupBy)
      ? grouped.having(({ ne }) => ne(groupKey, param.string("")))
      : grouped;
  const ordered = having.orderBy("period");
  return (date ? ordered.orderBy("date") : ordered)
    .settings({ ...settings, log_comment: "analytics:timeseries:trace_analytics" })
    .build() as ReaderReadStatement;
}
