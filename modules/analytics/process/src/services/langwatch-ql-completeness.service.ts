/**
 * The completeness report beside a LangWatchQL result: one aggregate over the view, window and
 * tenant scope the query read, so a widget can tell missing data from a real zero.
 * @see modules/analytics/specs/analytics-query-completeness.feature
 */
import {
  formatLangWatchQLDateTimeParameter,
  type LangWatchQLTimeWindow,
  type QueryCompleteness,
  type QueryCompletenessState,
} from "@langwatch/analytics-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";

import type { LangWatchQLExecutorRepository } from "../repositories/langwatch-ql-executor.repository.ts";
import { resolveTableReferences } from "../rules/langwatch-ql-diagnostics-shape.rules.ts";
import type { AcceptedLangWatchQL } from "../rules/langwatch-ql-validation-shape.rules.ts";
import type {
  LangWatchQLViewColumn,
  LangWatchQLViewDefinition,
} from "./langwatch-ql-catalog-shapes.service.ts";

const logger = createLogger("langwatch:analytics:lwql:completeness");

/** Written at ingestion: spans whose model had no price, and those models. */
const UNPRICED_COUNT_COLUMN = "UnpricedSpanCount";
const UNPRICED_MODELS_COLUMN = "UnpricedModels";
/** Enough names for a hover; the count of unpriced rows stays exact. */
const MAX_UNPRICED_MODELS = 20;
const COST_UNIT = "USD";

const START_PARAMETER = "completeness_window_start";
const END_PARAMETER = "completeness_window_end";
const GRANULARITY_PARAMETER = "completeness_granularity_seconds";

const NULLABLE_TYPE = /^Nullable\(/;
const TEMPORAL_TYPE = /^(?:Nullable\()?DateTime(?:64)?\b/;

/** What one report reads: the query's own view, and which of its columns to count. */
interface CompletenessPlan {
  readonly kind: "countable";
  readonly viewName: string;
  readonly unit: string;
  readonly timeColumn: string;
  readonly fields: readonly LangWatchQLViewColumn[];
  readonly readsCost: boolean;
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
  readonly validation: AcceptedLangWatchQL;
  readonly database: string;
  readonly views: readonly LangWatchQLViewDefinition[];
  /** The window the query was bound to. No window, no report: a whole history is not a period. */
  readonly timeWindow?: LangWatchQLTimeWindow;
  /** The step the query buckets by, when it follows the board granularity. */
  readonly granularitySeconds?: number;
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
    const plan = planCompleteness(input);
    if (plan.kind === "uncountable") return { kind: "skipped", reason: "uncountable_view" };

    try {
      const execution = await input.executor.execute({
        sql: completenessSql({ plan, isBucketed: granularitySeconds !== undefined }),
        parameters: {
          [START_PARAMETER]: formatLangWatchQLDateTimeParameter(timeWindow.start),
          [END_PARAMETER]: formatLangWatchQLDateTimeParameter(timeWindow.end),
          ...(granularitySeconds === undefined
            ? {}
            : { [GRANULARITY_PARAMETER]: granularitySeconds }),
        },
        tenantCapability: input.tenantCapability,
      });

      return {
        kind: "reported",
        completeness: assembleCompleteness({
          plan,
          rows: execution.rows,
          timeWindow,
          ...(granularitySeconds === undefined ? {} : { granularitySeconds }),
        }),
      };
    } catch (error) {
      logger.warn({ error, view: plan.viewName }, "LangWatchQL completeness report failed");
      return { kind: "skipped", reason: "report_failed" };
    }
  }
}

/**
 * The first catalogued view the query reads, and the nullable columns of it the query names.
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

  const referenced = new Set(validation.blocks.flatMap((block) => block.referencedColumns));
  const reads = (column: LangWatchQLViewColumn) => referenced.has(column.name.toLowerCase());
  const hasColumn = (name: string) => view.columns.some((column) => column.name === name);

  return {
    kind: "countable",
    viewName: reference.viewName,
    unit: unitOf(view.name),
    timeColumn: timeColumn.name,
    fields: view.columns.filter(
      (column) => NULLABLE_TYPE.test(column.type) && column !== timeColumn && reads(column),
    ),
    readsCost:
      view.columns.some((column) => column.unit === COST_UNIT && reads(column)) &&
      hasColumn(UNPRICED_COUNT_COLUMN) &&
      hasColumn(UNPRICED_MODELS_COLUMN),
  };
}

/** Catalogue identifiers only, never caller text; bucketed exactly as dashboard templates do. */
function completenessSql({
  plan,
  isBucketed,
}: {
  plan: CompletenessPlan;
  isBucketed: boolean;
}): string {
  const time = quoted(plan.timeColumn);
  const select = [
    ...(isBucketed
      ? [
          `toUnixTimestamp(toStartOfInterval(${time}, ` +
            `INTERVAL {${GRANULARITY_PARAMETER}:UInt32} SECOND)) AS bucket`,
        ]
      : []),
    "count() AS n",
    ...plan.fields.map((field, index) => `countIf(${quoted(field.name)} IS NOT NULL) AS f${index}`),
    ...(plan.readsCost
      ? [
          `countIf(${quoted(UNPRICED_COUNT_COLUMN)} > 0) AS unpriced_count`,
          `groupUniqArrayArray(${MAX_UNPRICED_MODELS})(${quoted(UNPRICED_MODELS_COLUMN)}) ` +
            "AS unpriced_models",
        ]
      : []),
  ];

  return (
    `SELECT ${select.join(", ")} FROM ${plan.viewName} ` +
    `WHERE ${time} >= {${START_PARAMETER}:DateTime} AND ${time} < {${END_PARAMETER}:DateTime}` +
    (isBucketed ? " GROUP BY bucket" : "")
  );
}

function assembleCompleteness({
  plan,
  rows,
  timeWindow,
  granularitySeconds,
}: {
  plan: CompletenessPlan;
  rows: readonly Record<string, unknown>[];
  timeWindow: LangWatchQLTimeWindow;
  granularitySeconds?: number;
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
      : { buckets: windowBuckets({ rows, timeWindow, granularitySeconds }) }),
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

/** Every bucket the window touches, including empty ones at either end, with its row count. */
function windowBuckets({
  rows,
  timeWindow,
  granularitySeconds,
}: {
  rows: readonly Record<string, unknown>[];
  timeWindow: LangWatchQLTimeWindow;
  granularitySeconds: number;
}): { start: string; n: number }[] {
  const counts = new Map(rows.map((row) => [countOf(row.bucket), countOf(row.n)]));
  const startSeconds = Temporal.Instant.from(timeWindow.start).epochMilliseconds / 1000;
  const endSeconds = Temporal.Instant.from(timeWindow.end).epochMilliseconds / 1000;
  const buckets: { start: string; n: number }[] = [];
  for (
    let bucket = Math.floor(startSeconds / granularitySeconds) * granularitySeconds;
    bucket < endSeconds;
    bucket += granularitySeconds
  ) {
    buckets.push({
      start: Temporal.Instant.fromEpochMilliseconds(bucket * 1000).toString(),
      n: counts.get(bucket) ?? 0,
    });
  }
  return buckets;
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
