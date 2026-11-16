/**
 * Pipeline series on the typed builder (ADR-202): a metric per user, thread, customer or trace,
 * re-aggregated over the entities, and the thread duration. Each re-aggregated series is its own
 * arm; the arms are stacked and folded per bucket, as main joined its per-series CTEs.
 */

import {
  type AnalyticsSeries,
  isZeroWhenAbsentSeries,
  type PipelineAggregationTypes,
  SeriesPercentageUnsupportedError,
} from "@langwatch/analytics-contract";
import {
  type ClickHouseReadStart,
  clickhouseRead,
  column,
  type Condition,
  cond,
  fn,
  param,
  type ProofScope,
  type ReaderReadStatement,
} from "@langwatch/clickhouse-client/builder";

import type { TimeseriesQueryInput } from "./clickhouse.aggregation-builder.mapper.ts";
import {
  type AnalyticsFilterInput,
  filterTranslations,
} from "./clickhouse.filter-conditions.mapper.ts";
import {
  type MetricSource,
  type MetricSpec,
  pipelineMetricSpecFor,
  renderMetric,
  shapeSeries,
  threadDuration,
} from "./clickhouse.metric-spec.mapper.ts";
import {
  allOf,
  currentPeriod,
  dateBucket,
  inEitherPeriod,
  type Measure,
  periodOf,
  previousPeriod,
  type TimeseriesRead,
} from "./clickhouse.timeseries-query-shared.mapper.ts";
import {
  filtersOf,
  GROUP_BYS,
  groupKeyFor,
  seriesAlias,
  seriesConditions,
  specOf,
} from "./clickhouse.trace-summaries-timeseries-query.mapper.ts";
import { traceSummaries as ts } from "./clickhouse.trace-summaries.table.ts";

type Summaries = "trace_summaries";
type Period = "current" | "previous";
type Row = Record<string, Measure>;

const SOURCE: MetricSource<Summaries> = {
  trace: (name) => ts[name],
  attribute: (key) => fn.mapGet(ts.Attributes, key),
  span: () => {
    throw new Error("The pipeline read carries trace-row metrics only.");
  },
  evaluation: () => {
    throw new Error("The pipeline read carries trace-row metrics only.");
  },
};

const NONE = () => fn.nullAs(column.nullable(column.float64()));
const EMPTY = param.string("");

/** A series' spec, its pipeline included. */
function pipelineSpecOf(series: AnalyticsSeries, index: number): MetricSpec {
  if (!series.pipeline) return specOf(series, index);
  return pipelineMetricSpecFor({
    metric: series.metric,
    aggregation: series.aggregation,
    pipelineField: series.pipeline.field,
    pipelineAggregation: series.pipeline.aggregation,
    index,
    key: series.key,
    subkey: series.subkey,
  });
}

/**
 * Whether the pipeline shape serves this query, as main routed it to its summary CTEs (full, no
 * grouping) or its date-bucketed pipeline (numeric): trace-row metrics, row filters, a pipeline.
 */
export function servesPipelines(input: TimeseriesQueryInput): boolean {
  const numeric = typeof input.timeScale === "number";
  if (!numeric && !(input.timeScale === "full" && !input.groupBy)) return false;
  if (input.groupBy && !GROUP_BYS[input.groupBy]) return false;
  let reaggregated = false;
  for (const [index, series] of input.series.entries()) {
    const spec = pipelineSpecOf(series, index);
    if (spec.joins.length > 0 || spec.form !== "scalar") return false;
    const filters = (series.filters ?? {}) as AnalyticsFilterInput;
    if (filterTranslations({ filters, ts }).some((each) => each.kind !== "row")) return false;
    if (spec.outer) reaggregated = true;
  }
  return reaggregated;
}

function outerAggregate<T extends string>(
  aggregation: PipelineAggregationTypes,
  of: Measure<T>,
): Measure<T> {
  switch (aggregation) {
    case "sum":
      return fn.sum(of);
    case "avg":
      return fn.avg(of);
    case "min":
      return fn.min(of);
    case "max":
      return fn.max(of);
  }
}

/** Where one arm reads: a period and its buckets, or both periods bucketed by date. */
type Bucketing = { kind: "period"; period: Period } | { kind: "dated"; scale: number };

type Parts = { scope: ProofScope; input: TimeseriesQueryInput; bucketing: Bucketing };

/** The bucket columns of a scan of the trace rows: period, date and group key. */
function bucketsOf({ input, bucketing }: Parts): Row {
  if (bucketing.kind === "period") return {};
  const buckets: Row = {
    period: periodOf(ts.OccurredAt, input),
    date: dateBucket(ts.OccurredAt, bucketing.scale, input.timeZone ?? "UTC"),
  };
  const grouping = input.groupBy ? GROUP_BYS[input.groupBy] : undefined;
  if (grouping) buckets.group_key = groupKeyFor(grouping);
  return buckets;
}

/** The trace rows in the arm's period(s), the dashboard's filters and a series' own. */
function traceScan({
  parts,
  own,
  selection,
  start = clickhouseRead({ scope: parts.scope }),
}: {
  parts: Parts;
  own: Condition<Summaries>[];
  selection: Row;
  start?: ClickHouseReadStart<ProofScope>;
}) {
  const { input, bucketing } = parts;
  const { filters, restrictions } = filtersOf(input);
  return start
    .from(ts)
    .withinWindows()
    .select(selection as Record<string, Measure<Summaries>>)
    .where(() => {
      if (bucketing.kind === "dated") return inEitherPeriod(ts.OccurredAt, input);
      return bucketing.period === "current"
        ? currentPeriod(ts.OccurredAt, input)
        : previousPeriod(ts.OccurredAt, input);
    })
    .where((ops) => allOf([filters(ops), ...restrictions, ...own]), { inElection: false })
    .latestVersion();
}

/** A derived read: a table to read from, and its columns by name. */
type Derived = ReturnType<ReturnType<typeof traceScan>["as"]>;
type Columns = Record<string, Measure | undefined>;

/** The non-empty key rule main's HAVING kept: ES `terms` skips a missing key. */
const present = <T extends string>(...keys: Measure<T>[]): Condition<T> =>
  allOf(keys.map((key) => cond.ne(key, EMPTY)));

type Reaggregated = { from: Derived; buckets: Row; value: Measure };

/** Thread durations per member's thread, then per entity when the series has a pipeline. */
function threadDurations({
  parts,
  spec,
  own,
  tag,
}: {
  parts: Parts;
  spec: MetricSpec;
  own: Condition<Summaries>[];
  tag: string;
}) {
  const outer = spec.outer as Extract<MetricSpec["outer"], { kind: "thread-duration" }>;
  const buckets = bucketsOf(parts);
  const names = Object.keys(buckets);
  const thread = outer.thread(SOURCE);
  const entityKey = outer.perEntity?.key(SOURCE);
  const keys = entityKey ? [entityKey, thread] : [thread];
  const selection: Row = {
    ...buckets,
    TenantId: ts.TenantId,
    ...(entityKey ? { pipeline_key: entityKey } : {}),
    thread_duration: threadDuration(ts.OccurredAt),
  };
  const threads: Derived = traceScan({ parts, own, selection })
    .groupBy(...(Object.values(buckets) as Measure<Summaries>[]), ts.TenantId, ...keys)
    .having(() => present(...keys))
    .as(`threads_${tag}`);
  const perThread: Columns = threads;
  const carried = (columns: Columns): Row =>
    Object.fromEntries(names.map((name) => [name, columns[name]!]));
  if (!outer.perEntity) {
    return {
      from: threads,
      buckets: carried(perThread),
      value: fn.avg(perThread.thread_duration!),
    };
  }
  const perEntityKeys = [...names, "TenantId", "pipeline_key"].map((name) => perThread[name]!);
  const entities: Derived = clickhouseRead({ scope: parts.scope })
    .from(threads)
    .select({ ...carried(perThread), entity_value: fn.avg(perThread.thread_duration!) } as never)
    .groupBy(...(perEntityKeys as never[]))
    .as(`entities_${tag}`);
  const inner: Columns = entities;
  return {
    from: entities,
    buckets: carried(inner),
    value: outerAggregate(outer.perEntity.aggregation, inner.entity_value!),
  };
}

/**
 * One re-aggregated series per bucket, as `value`: per member's entity (ruling 1a: TenantId in
 * every per-entity step), then over them. The series' filter decides which entities exist.
 */
function reaggregated(parts: Parts, series: AnalyticsSeries, index: number): Reaggregated {
  const spec = pipelineSpecOf(series, index);
  const own = seriesConditions(series);
  const tag = `${index}_${parts.bucketing.kind === "period" ? parts.bucketing.period : "dated"}`;
  if (spec.outer?.kind !== "per-entity") return threadDurations({ parts, spec, own, tag });
  const buckets = bucketsOf(parts);
  const key = spec.outer.key(SOURCE);
  const value = renderMetric({ spec: { ...spec, outer: undefined }, source: SOURCE });
  const entities: Derived = traceScan({ parts, own, selection: { ...buckets, inner_value: value } })
    .groupBy(...(Object.values(buckets) as Measure<Summaries>[]), ts.TenantId, key)
    .having(() => present(key))
    .as(`entities_${tag}`);
  const inner: Columns = entities;
  return {
    from: entities,
    buckets: Object.fromEntries(Object.keys(buckets).map((name) => [name, inner[name]!])),
    value: outerAggregate(spec.outer.aggregation, inner.inner_value!),
  };
}

/** One arm of the stack: the arms read different tables, so their reads are typed loose. */
type Arm = (start: ClickHouseReadStart<ProofScope>) => unknown;
type Stack = {
  unionAll(build: (start: ClickHouseReadStart<ProofScope>) => never): Stack;
  as(alias: "sources"): Derived;
};

/** What every arm of one bucketing shares: the series' keys and specs, and the key rule. */
type ArmContext = {
  parts: Parts;
  aliases: string[];
  specs: MetricSpec[];
  keepsKey: boolean;
};

/** `period` as a literal when the arm reads one period. */
const periodColumns = ({ bucketing }: Parts): Row =>
  bucketing.kind === "period" ? { period: param.string(bucketing.period) } : {};

/**
 * Every series in each arm: its own measure as Float64 (one arm's UInt64 beside another's Float64
 * would stack as a Variant), a typed NULL for the others, and whether the arm anchors the buckets.
 */
function valuesWith(context: ArmContext, own: Record<string, Measure>, anchored: boolean): Row {
  return {
    ...Object.fromEntries(
      context.aliases.map((alias) => [alias, own[alias] ? fn.toFloat64(own[alias]) : NONE()]),
    ),
    anchored: param.uint32(anchored ? 1 : 0),
  };
}

/** The trace-row series of a pipeline query, together on one scan. */
function simpleArm(context: ArmContext, simple: number[]): Arm {
  const { parts, aliases, specs, keepsKey } = context;
  return (start) => {
    const buckets = bucketsOf(parts);
    const measures = Object.fromEntries(
      simple.map((index) => {
        const series = parts.input.series[index]!;
        const conditions = seriesConditions(series);
        const measure = shapeSeries({
          series,
          when: conditions.length > 0 ? allOf(conditions) : undefined,
          render: (when) => renderMetric({ spec: specs[index]!, source: SOURCE, when }),
        });
        return [aliases[index]!, measure];
      }),
    );
    const selection = {
      ...periodColumns(parts),
      ...buckets,
      ...valuesWith(context, measures, true),
    };
    const scan = traceScan({ parts, own: [], selection, start });
    if (parts.bucketing.kind === "period") return scan;
    const grouped = scan.groupBy(...(Object.values(buckets) as Measure<Summaries>[]));
    return keepsKey
      ? grouped.having(() => present(buckets.group_key as Measure<Summaries>))
      : grouped;
  };
}

/** One re-aggregated series, folded per bucket. */
function reaggregatedArm(context: ArmContext, index: number, anchored: boolean): Arm {
  const { parts, aliases, keepsKey } = context;
  const series = parts.input.series[index]!;
  if (series.asPercent && seriesConditions(series).length > 0) {
    throw new SeriesPercentageUnsupportedError();
  }
  return (start) => {
    const { from, buckets, value } = reaggregated(parts, series, index);
    const own = { [aliases[index]!]: value };
    const read = start.from(from).select({
      ...periodColumns(parts),
      ...buckets,
      ...valuesWith(context, own, anchored),
    } as never);
    if (parts.bucketing.kind === "period") return read;
    const grouped = read.groupBy(...(Object.values(buckets) as never[]));
    return keepsKey ? grouped.having(() => present(buckets.group_key!) as never) : grouped;
  };
}

/** The arms of one bucketing: the trace-row series together, then each re-aggregated series. */
function armsOf(parts: Parts): { arms: Arm[]; reaggregatedAliases: Set<string> } {
  const { input } = parts;
  const specs = input.series.map((series, index) => pipelineSpecOf(series, index));
  const grouping = input.groupBy ? GROUP_BYS[input.groupBy] : undefined;
  const context: ArmContext = {
    parts,
    aliases: aliasesOf(input),
    specs,
    keepsKey: grouping !== undefined && !grouping.handlesUnknown,
  };
  const indexes = specs.map((_, index) => index);
  const simple = indexes.filter((index) => !specs[index]!.outer);
  const reaggregatedIndexes = indexes.filter((index) => specs[index]!.outer);
  const arms = simple.length > 0 ? [simpleArm(context, simple)] : [];
  for (const index of reaggregatedIndexes) {
    arms.push(reaggregatedArm(context, index, arms.length === 0));
  }
  return {
    arms,
    reaggregatedAliases: new Set(reaggregatedIndexes.map((index) => context.aliases[index]!)),
  };
}

/** Each series' result key, in the order the dashboard asked them. */
function aliasesOf(input: TimeseriesQueryInput): string[] {
  return input.series.map((series, index) => seriesAlias(series, index));
}

function stacked(scope: ProofScope, arms: Arm[]): Derived {
  const [first, ...rest] = arms;
  let read = first!(clickhouseRead({ scope })) as Stack;
  for (const arm of rest) read = read.unionAll((start) => arm(start) as never);
  return read.as("sources");
}

const LOG_COMMENT = "analytics:timeseries:trace_summaries:pipelines";

/** Both periods, one row each: main's scalar CTEs, additive series coalesced to 0. */
function summaryRead({ scope, input, settings }: TimeseriesRead): ReaderReadStatement {
  const arms = (["current", "previous"] as const).flatMap(
    (period) => armsOf({ scope, input, bucketing: { kind: "period", period } }).arms,
  );
  const sources = stacked(scope, arms);
  const columns: Columns = sources;
  const selection: Row = { period: columns.period! };
  for (const [index, alias] of aliasesOf(input).entries()) {
    const value = fn.any(columns[alias]!);
    selection[alias] = isZeroWhenAbsentSeries(input.series[index]!)
      ? fn.coalesce(value, param.uint32(0))
      : value;
  }
  return clickhouseRead({ scope })
    .from(sources)
    .select(selection as never)
    .groupBy(columns.period! as never)
    .orderBy("period" as never)
    .settings({ ...settings, log_comment: LOG_COMMENT })
    .build() as ReaderReadStatement;
}

/** The pipeline trace_summaries timeseries read; see {@link servesPipelines}. */
export function pipelineTimeseriesRead(read: TimeseriesRead): ReaderReadStatement {
  const { scope, input, settings } = read;
  if (typeof input.timeScale !== "number") return summaryRead(read);
  const parts: Parts = { scope, input, bucketing: { kind: "dated", scale: input.timeScale } };
  const { arms, reaggregatedAliases } = armsOf(parts);
  const sources = stacked(scope, arms);
  const columns: Columns = sources;
  const keys = ["period", "date", ...(input.groupBy ? ["group_key"] : [])];
  const selection: Row = Object.fromEntries(keys.map((key) => [key, columns[key]!]));
  const defaulted = arms.length > 1;
  for (const alias of aliasesOf(input)) {
    const value = fn.any(columns[alias]!);
    // Main joined each series' CTE to the first: a bucket a series lacks read its type's default.
    selection[alias] =
      defaulted && reaggregatedAliases.has(alias) ? fn.ifNull(value, param.uint32(0)) : value;
  }
  // Main kept the first source's buckets only (FULL JOIN, then `period IS NOT NULL`).
  return clickhouseRead({ scope })
    .from(sources)
    .select(selection as never)
    .groupBy(...(keys.map((key) => columns[key]!) as never[]))
    .having(() => cond.gt(fn.max(columns.anchored!), 0) as never)
    .orderBy("period" as never)
    .orderBy("date" as never)
    .settings({ ...settings, log_comment: LOG_COMMENT })
    .build() as ReaderReadStatement;
}
