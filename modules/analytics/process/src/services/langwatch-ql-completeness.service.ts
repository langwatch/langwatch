/**
 * The completeness report beside a LangWatchQL result: one aggregate over the view, window and
 * tenant scope the query read, so a widget can tell missing data from a real zero.
 * @see modules/analytics/specs/analytics-query-completeness.feature
 */
import {
  formatLangWatchQLDateTimeParameter,
  LWQL_BUCKET_ALIGNMENT_SECONDS,
  LWQL_DEFAULT_TIME_ZONE,
  lwqlBucketStartSql,
  LWQL_WALL_CLOCK_GRANULARITY_SECONDS,
  type LangWatchQLMemberWindow,
  type LangWatchQLTimeWindow,
  type QueryCompleteness,
  type QueryCompletenessState,
} from "@langwatch/analytics-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";

import type { LangWatchQLExecutorRepository } from "../repositories/langwatch-ql-executor.repository.ts";
import { resolveTableReferences } from "../rules/langwatch-ql-diagnostics-shape.rules.ts";
import { scopeLangWatchQL } from "../rules/langwatch-ql-query-scope.rules.ts";
import type { AcceptedLangWatchQL } from "../rules/langwatch-ql-validation-shape.rules.ts";
import type {
  LangWatchQLViewColumn,
  LangWatchQLViewDefinition,
} from "./langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLFlooredReadService } from "./langwatch-ql-floored-read.service.ts";

const flooredRead = LangWatchQLFlooredReadService.create();

const logger = createLogger("langwatch:analytics:lwql:completeness");

/** Written at ingestion: spans whose model had no price, and those models. */
const UNPRICED_COUNT_COLUMN = "UnpricedSpanCount";
const UNPRICED_MODELS_COLUMN = "UnpricedModels";
const MODELS_COLUMN = "Models";
/** Enough names for a hover; the count of unpriced rows stays exact. */
const MAX_UNPRICED_MODELS = 20;
const COST_UNIT = "USD";

const START_PARAMETER = "completeness_window_start";
const END_PARAMETER = "completeness_window_end";
const GRANULARITY_PARAMETER = "completeness_granularity_seconds";
const TIME_ZONE_PARAMETER = "completeness_time_zone";

const NULLABLE_TYPE = /^Nullable\(/;
const TEMPORAL_TYPE = /^(?:Nullable\()?DateTime(?:64)?\b/;

/** What one report reads: the query's own view, and which of its columns to count. */
interface CompletenessPlan {
  readonly kind: "countable";
  readonly viewName: string;
  /** The view's bare name, its alias in the report's FROM. */
  readonly alias: string;
  readonly unit: string;
  readonly timeColumn: string;
  readonly fields: readonly LangWatchQLViewColumn[];
  /** The view records unpriced spans and the query reads a cost from it. */
  readonly readsCost: boolean;
  /** The view names the models a row called, so a row that called none owes no cost. */
  readonly recordsModels: boolean;
}

/** Why a result carries no report. Each is expected, so none is an error. */
export type LangWatchQLCompletenessSkipReason = "no_window" | "uncountable_view" | "report_failed";

/** A report, or the named reason there is none. */
export type LangWatchQLCompletenessOutcome =
  | { readonly kind: "reported"; readonly completeness: QueryCompleteness }
  | { readonly kind: "skipped"; readonly reason: LangWatchQLCompletenessSkipReason };

export interface LangWatchQLCompletenessInput {
  readonly executor: LangWatchQLExecutorRepository;
  /** The capability the main query ran with, so the report sees exactly its tenants. */
  readonly tenantCapability: string;
  /** The projects that capability scopes, named in the query log's comment. */
  readonly projectIds: readonly string[];
  readonly validation: AcceptedLangWatchQL;
  readonly database: string;
  readonly views: readonly LangWatchQLViewDefinition[];
  /** The members the main query read and from when, so the report counts the same rows. */
  readonly memberWindows?: readonly LangWatchQLMemberWindow[];
  /** The window the query was bound to. No window, no report: a whole history is not a period. */
  readonly timeWindow?: LangWatchQLTimeWindow;
  /** The step the query buckets by, when it follows the board granularity. */
  readonly granularitySeconds?: number;
  /** The zone the query buckets by, when it declares the time zone; UTC otherwise. */
  readonly timeZone?: string;
}

/** Builds `completeness` for a query that already ran. */
export class LangWatchQLCompletenessService {
  static create(): LangWatchQLCompletenessService {
    return new LangWatchQLCompletenessService();
  }

  private constructor() {}

  /** Never throws: a failed report leaves the rows the member asked for intact. */
  async assess(input: LangWatchQLCompletenessInput): Promise<LangWatchQLCompletenessOutcome> {
    const { timeWindow, granularitySeconds } = input;
    if (!timeWindow) return { kind: "skipped", reason: "no_window" };
    // UTC buckets are the plain epoch ones, so only another zone pays for the wall-clock read.
    const timeZone = input.timeZone === LWQL_DEFAULT_TIME_ZONE ? undefined : input.timeZone;
    const plan = planCompleteness(input);
    if (plan.kind === "uncountable") return { kind: "skipped", reason: "uncountable_view" };

    try {
      const execution = await flooredRead.execute({
        executor: input.executor,
        request: {
          sql: scopeLangWatchQL({
            sql: completenessSql({
              plan,
              isBucketed: granularitySeconds !== undefined,
              isZoned: timeZone !== undefined,
            }),
            database: input.database,
            views: input.views,
            timeWindow,
            ...(input.memberWindows ? { memberWindows: input.memberWindows } : {}),
            projectIds: input.projectIds,
          }),
          parameters: {
            [START_PARAMETER]: formatLangWatchQLDateTimeParameter(timeWindow.start),
            [END_PARAMETER]: formatLangWatchQLDateTimeParameter(timeWindow.end),
            ...(granularitySeconds === undefined
              ? {}
              : { [GRANULARITY_PARAMETER]: granularitySeconds }),
            ...(timeZone === undefined ? {} : { [TIME_ZONE_PARAMETER]: timeZone }),
          },
          tenantCapability: input.tenantCapability,
          projectIds: input.projectIds,
        },
        database: input.database,
        views: input.views,
      });

      return {
        kind: "reported",
        completeness: assembleCompleteness({
          plan,
          rows: execution.rows,
          timeWindow,
          ...(granularitySeconds === undefined ? {} : { granularitySeconds }),
          ...(timeZone === undefined ? {} : { timeZone }),
        }),
      };
    } catch (error) {
      logger.warn({ error, view: plan.viewName }, "LangWatchQL completeness report failed");
      return { kind: "skipped", reason: "report_failed" };
    }
  }
}

/**
 * The first catalogued view the query reads, and the columns its result is made of that a row
 * can lack. A filter or sort only picks rows, so a column named nowhere else does not count.
 * A rollup view is skipped: its rows are buckets, so `count()` would not count traces.
 */
function planCompleteness({
  validation,
  database,
  views,
}: Pick<LangWatchQLCompletenessInput, "validation" | "database" | "views">):
  | CompletenessPlan
  | { readonly kind: "uncountable" } {
  const [reference] = validation.blocks.flatMap((block) =>
    resolveTableReferences({ block, database, views }),
  );
  if (!reference) return { kind: "uncountable" };

  const { view } = reference;
  const timeColumn = view.columns.find((column) => column.name === view.timeColumn);
  if (view.dedup.aggregating || !timeColumn || !TEMPORAL_TYPE.test(timeColumn.type)) {
    return { kind: "uncountable" };
  }

  const read = new Set(
    validation.blocks.flatMap((block) => [...block.projectedColumns, ...block.groupByColumns]),
  );
  const reads = (column: LangWatchQLViewColumn) => read.has(column.name.toLowerCase());
  const hasColumn = (name: string) => view.columns.some((column) => column.name === name);
  const recordsUnpriced = hasColumn(UNPRICED_COUNT_COLUMN) && hasColumn(UNPRICED_MODELS_COLUMN);
  // Only a view that records unpriced spans can tell a price gap; a span cost is null on
  // every span that made no model call, so it is not counted.
  const canLack = (column: LangWatchQLViewColumn) =>
    isCost(column)
      ? recordsUnpriced
      : NULLABLE_TYPE.test(column.type) && column.nullIsValue !== true;
  const fields = view.columns.filter(
    (column) => column !== timeColumn && reads(column) && canLack(column),
  );

  return {
    kind: "countable",
    viewName: reference.viewName,
    alias: view.name,
    unit: unitOf(view.name),
    timeColumn: timeColumn.name,
    fields,
    readsCost: fields.some(isCost),
    recordsModels: hasColumn(MODELS_COLUMN),
  };
}

function isCost(column: LangWatchQLViewColumn): boolean {
  return column.unit === COST_UNIT;
}

/**
 * A cost is present on a row with no unpriced span that either carries a cost or called no
 * model: a model call with no cost is a gap, never a known $0, while a tool-only or $0 trace
 * stores no cost and owes none. A view that names no models keeps the unpriced rule alone.
 */
function presentSql({
  field,
  recordsModels,
}: {
  field: LangWatchQLViewColumn;
  recordsModels: boolean;
}): string {
  const carried = `${quoted(field.name)} IS NOT NULL`;
  if (!isCost(field)) return `countIf(${carried})`;
  const priced = `${quoted(UNPRICED_COUNT_COLUMN)} = 0`;
  return recordsModels
    ? `countIf(${priced} AND (${carried} OR empty(${quoted(MODELS_COLUMN)})))`
    : `countIf(${priced})`;
}

/**
 * Catalogue identifiers only, never caller text; bucketed exactly as dashboard templates do.
 * Aliased so the floor can send a bounded read to the view's floored twin from the start.
 */
function completenessSql({
  plan,
  isBucketed,
  isZoned,
}: {
  plan: CompletenessPlan;
  isBucketed: boolean;
  isZoned: boolean;
}): string {
  const time = quoted(plan.timeColumn);
  const bucket = lwqlBucketStartSql({
    column: time,
    granularity: `{${GRANULARITY_PARAMETER}:UInt32}`,
    ...(isZoned ? { timeZone: `{${TIME_ZONE_PARAMETER}:String}` } : {}),
  });
  const select = [
    ...(isBucketed ? [`toUnixTimestamp(${bucket}) AS bucket`] : []),
    "count() AS n",
    ...plan.fields.map(
      (field, index) => `${presentSql({ field, recordsModels: plan.recordsModels })} AS f${index}`,
    ),
    ...(plan.readsCost
      ? [
          `countIf(${quoted(UNPRICED_COUNT_COLUMN)} > 0) AS unpriced_count`,
          `groupUniqArrayArray(${MAX_UNPRICED_MODELS})(${quoted(UNPRICED_MODELS_COLUMN)}) ` +
            "AS unpriced_models",
        ]
      : []),
  ];

  return (
    `SELECT ${select.join(", ")} FROM ${plan.viewName} AS ${plan.alias} ` +
    `WHERE ${time} >= {${START_PARAMETER}:DateTime} AND ${time} < {${END_PARAMETER}:DateTime}` +
    (isBucketed ? " GROUP BY bucket" : "")
  );
}

function assembleCompleteness({
  plan,
  rows,
  timeWindow,
  granularitySeconds,
  timeZone,
}: {
  plan: CompletenessPlan;
  rows: readonly Record<string, unknown>[];
  timeWindow: LangWatchQLTimeWindow;
  granularitySeconds?: number;
  timeZone?: string;
}): QueryCompleteness {
  const sum = (key: string) => rows.reduce((total, row) => total + countOf(row[key]), 0);
  const total = sum("n");
  const fields = plan.fields.map((field, index) => ({
    field: field.name,
    label: labelOf(field.name),
    present: sum(`f${index}`),
  }));
  const unpriced = plan.readsCost
    ? {
        count: sum("unpriced_count"),
        models: [...new Set(rows.flatMap((row) => modelsOf(row.unpriced_models)))]
          .toSorted()
          .slice(0, MAX_UNPRICED_MODELS),
      }
    : undefined;

  return {
    state: stateOf({ total, fields, unpricedCount: unpriced?.count ?? 0 }),
    unit: plan.unit,
    total,
    fields,
    ...(granularitySeconds === undefined
      ? {}
      : {
          buckets: windowBuckets({
            rows,
            timeWindow,
            granularitySeconds,
            timeZone: timeZone ?? LWQL_DEFAULT_TIME_ZONE,
          }),
        }),
    ...(unpriced ? { unpriced } : {}),
  };
}

function stateOf({
  total,
  fields,
  unpricedCount,
}: {
  total: number;
  fields: readonly { present: number }[];
  unpricedCount: number;
}): QueryCompletenessState {
  if (total === 0) return "no_traffic";
  if (fields.some((field) => field.present === 0)) return "missing";
  if (fields.some((field) => field.present < total) || unpricedCount > 0) return "partial";
  return "complete";
}

/**
 * Every bucket the window touches, empty ones at either end included, with its row count. Floors
 * as `lwqlBucketStartSql` does: a sub-day step on the instant, a day or longer on the zone's wall
 * clock, so a DST day is 23 or 25 hours long and a DST night has 23 or 25 hourly buckets.
 */
function windowBuckets({
  rows,
  timeWindow,
  granularitySeconds,
  timeZone,
}: {
  rows: readonly Record<string, unknown>[];
  timeWindow: LangWatchQLTimeWindow;
  granularitySeconds: number;
  timeZone: string;
}): { start: string; n: number }[] {
  const counts = new Map(rows.map((row) => [countOf(row.bucket), countOf(row.n)]));
  const endSeconds = Temporal.Instant.from(timeWindow.end).epochMilliseconds / 1000;
  if (granularitySeconds < LWQL_WALL_CLOCK_GRANULARITY_SECONDS) {
    return instantBuckets({ counts, timeWindow, endSeconds, granularitySeconds });
  }
  const startWallSeconds = wallSeconds({ instant: timeWindow.start, timeZone });
  const endWallSeconds = wallSeconds({ instant: timeWindow.end, timeZone });
  const shift = LWQL_BUCKET_ALIGNMENT_SECONDS;
  const firstWall =
    Math.floor((Math.floor(startWallSeconds) - shift) / granularitySeconds) * granularitySeconds +
    shift;
  // One step past the window covers the hour a DST night adds to the wall clock.
  const steps = Math.ceil((endWallSeconds - firstWall) / granularitySeconds) + 2;
  const buckets: { start: string; n: number }[] = [];
  const seen = new Set<number>();
  for (let step = 0; step < steps; step += 1) {
    const wall = firstWall + step * granularitySeconds;
    const instant = Temporal.Instant.fromEpochMilliseconds(wall * 1000)
      .toZonedDateTimeISO("UTC")
      .toPlainDateTime()
      .toZonedDateTime(timeZone, { disambiguation: "compatible" })
      .toInstant();
    const seconds = instant.epochMilliseconds / 1000;
    if (seconds >= endSeconds) break;
    // A wall time the spring-forward night skips lands on a real later time the loop visits too.
    if (seen.has(seconds)) continue;
    seen.add(seconds);
    buckets.push({ start: instant.toString(), n: counts.get(seconds) ?? 0 });
  }
  return buckets;
}

/** Sub-day buckets: whole steps of the instant from the alignment, the same in every zone. */
function instantBuckets({
  counts,
  timeWindow,
  endSeconds,
  granularitySeconds,
}: {
  counts: ReadonlyMap<number, number>;
  timeWindow: LangWatchQLTimeWindow;
  endSeconds: number;
  granularitySeconds: number;
}): { start: string; n: number }[] {
  const shift = LWQL_BUCKET_ALIGNMENT_SECONDS;
  const startSeconds = Math.floor(Temporal.Instant.from(timeWindow.start).epochMilliseconds / 1000);
  const first =
    Math.floor((startSeconds - shift) / granularitySeconds) * granularitySeconds + shift;
  const buckets: { start: string; n: number }[] = [];
  for (let seconds = first; seconds < endSeconds; seconds += granularitySeconds) {
    buckets.push({
      start: Temporal.Instant.fromEpochMilliseconds(seconds * 1000).toString(),
      n: counts.get(seconds) ?? 0,
    });
  }
  return buckets;
}

/** An instant's wall-clock time in the zone, as seconds on a UTC clock reading the same digits. */
function wallSeconds({ instant, timeZone }: { instant: string; timeZone: string }): number {
  const wall = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDateTime();
  return wall.toZonedDateTime("UTC").epochMilliseconds / 1000;
}

/** ClickHouse JSON quotes 64-bit integers, so a count can arrive as a string. */
function countOf(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

function modelsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((model): model is string => typeof model === "string" && model !== "")
    : [];
}

/** `trace_metrics` counts traces, `evaluation_metrics` evaluations. */
function unitOf(viewName: string): string {
  return viewName.replace(/_metrics$/, "s").replaceAll("_", " ");
}

/** `TimeToFirstTokenMs` reads as "time to first token", `TopicId` as "topic". */
function labelOf(columnName: string): string {
  return columnName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/ (ms|id)$/, "");
}

function quoted(identifier: string): string {
  return `\`${identifier}\``;
}
