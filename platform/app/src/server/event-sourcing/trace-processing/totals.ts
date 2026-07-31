import {
  type AnyColumnDef,
  bindIdentifiers,
  type ClickHouseClient,
  type ClickHouseQueryResult,
  ch,
  createRowCodec,
} from "@langwatch/clickhouse";
import { MAX_PROCESSED_SPANS, roundCost } from "./spanDerivation";
import { storedSpansTable } from "./table";

/**
 * "A trace's totals are a query over its spans, never counters on the trace
 * row" (ADR-103 decision 1). The dedup subquery picks the latest `WrittenAt`
 * per span, so a redelivered span cannot inflate a sum.
 */

export interface TraceTotals {
  readonly traceId: string;
  readonly spanCount: number;
  readonly rootSpanCount: number;
  /** Past {@link MAX_PROCESSED_SPANS}, so per-span work downstream can back off. */
  readonly oversized: boolean;
  /** `null` when nothing priced the trace at all, `0` when it genuinely cost nothing. */
  readonly totalCost: number | null;
  readonly nonBilledCost: number | null;
  readonly hasTokenUsage: boolean;
  readonly tokensEstimated: boolean;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
}

export interface SpanRollupBucket {
  readonly bucketStartMs: number;
  readonly model: string;
  readonly spanType: string;
  readonly spanCount: number;
  readonly traceCount: number;
  readonly errorCount: number;
  readonly costSum: number;
  readonly nonBilledCostSum: number;
  readonly durationSumMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
}

export interface DerivedQuery {
  readonly sql: string;
  readonly params: Record<string, unknown>;
}

const ROLLUP_BUCKET_MS = 60_000;

const TRACE_TOTALS_COLUMNS = {
  TraceId: ch.string(),
  SpanCount: ch.uint64(),
  RootSpanCount: ch.uint64(),
  CostSum: ch.float64(),
  CostCount: ch.uint64(),
  NonBilledCostSum: ch.float64(),
  NonBilledCostCount: ch.uint64(),
  PromptTokens: ch.uint64(),
  CompletionTokens: ch.uint64(),
  CacheReadTokens: ch.uint64(),
  CacheWriteTokens: ch.uint64(),
  ReasoningTokens: ch.uint64(),
  TokenReportCount: ch.uint64(),
  EstimatedCount: ch.uint64(),
} as const;

const SPAN_ROLLUP_COLUMNS = {
  BucketStartMs: ch.uint64(),
  Model: ch.string(),
  SpanType: ch.string(),
  SpanCount: ch.uint64(),
  TraceCount: ch.uint64(),
  ErrorCount: ch.uint64(),
  CostSum: ch.float64(),
  NonBilledCostSum: ch.float64(),
  DurationSumMs: ch.uint64(),
  PromptTokens: ch.uint64(),
  CompletionTokens: ch.uint64(),
  CacheReadTokens: ch.uint64(),
  CacheWriteTokens: ch.uint64(),
  ReasoningTokens: ch.uint64(),
} as const;

export interface AcceptedAtRange {
  readonly from: Date;
  readonly to: Date;
}

export function buildTraceTotalsQuery(args: {
  readonly tenantId: string;
  readonly traceIds: readonly string[];
  readonly acceptedAtRange?: AcceptedAtRange;
}): DerivedQuery {
  const names = bindIdentifiers();
  const table = names.of(storedSpansTable.name);
  const at = (prefix: string, column: string) => `${prefix}${names.of(column)}`;
  const col = (column: string) => at("t.", column);
  const dedupKey = (prefix: string) =>
    storedSpansTable.sortKey.map((column) => at(prefix, column)).join(", ");
  const scope = (prefix: string) =>
    `WHERE ${at(prefix, "TenantId")} = {tenantId:String} ` +
    `AND ${at(prefix, "TraceId")} IN {traceIds:Array(String)}`;

  const sql =
    `SELECT ${col("TraceId")} AS TraceId, ` +
    `count() AS SpanCount, ` +
    `countIf(${col("ParentSpanId")} IS NULL) AS RootSpanCount, ` +
    `sum(ifNull(${col("Cost")}, 0)) AS CostSum, ` +
    `countIf(${col("Cost")} IS NOT NULL) AS CostCount, ` +
    `sum(ifNull(${col("NonBilledCost")}, 0)) AS NonBilledCostSum, ` +
    `countIf(${col("NonBilledCost")} IS NOT NULL) AS NonBilledCostCount, ` +
    `sum(ifNull(${col("PromptTokens")}, 0)) AS PromptTokens, ` +
    `sum(ifNull(${col("CompletionTokens")}, 0)) AS CompletionTokens, ` +
    `sum(ifNull(${col("CacheReadTokens")}, 0)) AS CacheReadTokens, ` +
    `sum(ifNull(${col("CacheWriteTokens")}, 0)) AS CacheWriteTokens, ` +
    `sum(ifNull(${col("ReasoningTokens")}, 0)) AS ReasoningTokens, ` +
    `countIf(${col("PromptTokens")} IS NOT NULL OR ${col("CompletionTokens")} IS NOT NULL ` +
    `OR ${col("ReasoningTokens")} IS NOT NULL) AS TokenReportCount, ` +
    `countIf(${col("TokensEstimated")}) AS EstimatedCount ` +
    `FROM ${table} AS t ` +
    `${scope("t.")} ` +
    acceptedAtPredicate(names, "t.", args.acceptedAtRange) +
    `AND (${dedupKey("t.")}, ${col("WrittenAt")}) IN (` +
    `SELECT ${dedupKey("")}, max(${names.of("WrittenAt")}) ` +
    `FROM ${table} ` +
    `${scope("")} ` +
    `GROUP BY ${dedupKey("")}) ` +
    `GROUP BY ${col("TraceId")}`;

  return {
    sql,
    params: {
      ...names.params,
      tenantId: args.tenantId,
      traceIds: [...args.traceIds],
      ...rangeParams(args.acceptedAtRange),
    },
  };
}

/**
 * Per-(minute, model, span type) measures, so a dashboard never folds a rollup
 * of its own. `bucketStartMs` is integer arithmetic on the span's own start, so
 * the bucket a span lands in never depends on a session timezone.
 */
export function buildSpanRollupQuery(args: {
  readonly tenantId: string;
  readonly acceptedAtRange: AcceptedAtRange;
}): DerivedQuery {
  const names = bindIdentifiers();
  const table = names.of(storedSpansTable.name);
  const at = (prefix: string, column: string) => `${prefix}${names.of(column)}`;
  const col = (column: string) => at("t.", column);
  const dedupKey = (prefix: string) =>
    storedSpansTable.sortKey.map((column) => at(prefix, column)).join(", ");
  // The range bounds the dedup scope too: without a trace to key on, an
  // unbounded subquery would scan every partition the tenant has.
  const scope = (prefix: string) =>
    `WHERE ${at(prefix, "TenantId")} = {tenantId:String} ` +
    `AND ${at(prefix, "AcceptedAt")} >= {acceptedAtFrom:DateTime64(3)} ` +
    `AND ${at(prefix, "AcceptedAt")} <= {acceptedAtTo:DateTime64(3)}`;

  const bucket = `intDiv(${col("StartTimeUnixMs")}, ${ROLLUP_BUCKET_MS}) * ${ROLLUP_BUCKET_MS}`;
  const isRoot = `${col("ParentSpanId")} IS NULL`;

  const sql =
    `SELECT toUInt64(${bucket}) AS BucketStartMs, ` +
    `toString(${col("Model")}) AS Model, ` +
    `toString(${col("SpanType")}) AS SpanType, ` +
    `count() AS SpanCount, ` +
    `countIf(${isRoot}) AS TraceCount, ` +
    `countIf(${isRoot} AND ${col("StatusCode")} = 'ERROR') AS ErrorCount, ` +
    `sum(ifNull(${col("Cost")}, 0)) AS CostSum, ` +
    `sum(ifNull(${col("NonBilledCost")}, 0)) AS NonBilledCostSum, ` +
    `sumIf(${col("DurationMs")}, ${isRoot}) AS DurationSumMs, ` +
    `sum(ifNull(${col("PromptTokens")}, 0)) AS PromptTokens, ` +
    `sum(ifNull(${col("CompletionTokens")}, 0)) AS CompletionTokens, ` +
    `sum(ifNull(${col("CacheReadTokens")}, 0)) AS CacheReadTokens, ` +
    `sum(ifNull(${col("CacheWriteTokens")}, 0)) AS CacheWriteTokens, ` +
    `sum(ifNull(${col("ReasoningTokens")}, 0)) AS ReasoningTokens ` +
    `FROM ${table} AS t ` +
    `${scope("t.")} ` +
    `AND (${dedupKey("t.")}, ${col("WrittenAt")}) IN (` +
    `SELECT ${dedupKey("")}, max(${names.of("WrittenAt")}) ` +
    `FROM ${table} ` +
    `${scope("")} ` +
    `GROUP BY ${dedupKey("")}) ` +
    `GROUP BY BucketStartMs, Model, SpanType ` +
    `ORDER BY BucketStartMs, Model, SpanType`;

  return {
    sql,
    params: {
      ...names.params,
      tenantId: args.tenantId,
      ...rangeParams(args.acceptedAtRange),
    },
  };
}

export async function deriveTraceTotals(args: {
  readonly client: ClickHouseClient;
  readonly tenantId: string;
  readonly traceIds: readonly string[];
  readonly acceptedAtRange?: AcceptedAtRange;
}): Promise<TraceTotals[]> {
  if (args.traceIds.length === 0) return [];
  const query = buildTraceTotalsQuery(args);
  const result = await args.client.query({
    tenantId: args.tenantId,
    sql: query.sql,
    params: query.params,
  });

  return decode(TRACE_TOTALS_COLUMNS, result).map((row) => {
    const costCount = Number(row.CostCount);
    const nonBilledCount = Number(row.NonBilledCostCount);
    const spanCount = Number(row.SpanCount);
    const hasTokenUsage = Number(row.TokenReportCount) > 0;
    return {
      traceId: String(row.TraceId),
      spanCount,
      rootSpanCount: Number(row.RootSpanCount),
      oversized: spanCount > MAX_PROCESSED_SPANS,
      totalCost:
        costCount > 0
          ? roundCost(Number(row.CostSum))
          : hasTokenUsage
            ? 0
            : null,
      nonBilledCost:
        nonBilledCount > 0 ? roundCost(Number(row.NonBilledCostSum)) : null,
      hasTokenUsage,
      tokensEstimated: Number(row.EstimatedCount) > 0,
      promptTokens: Number(row.PromptTokens),
      completionTokens: Number(row.CompletionTokens),
      cacheReadTokens: Number(row.CacheReadTokens),
      cacheWriteTokens: Number(row.CacheWriteTokens),
      reasoningTokens: Number(row.ReasoningTokens),
    };
  });
}

export async function querySpanRollup(args: {
  readonly client: ClickHouseClient;
  readonly tenantId: string;
  readonly acceptedAtRange: AcceptedAtRange;
}): Promise<SpanRollupBucket[]> {
  const query = buildSpanRollupQuery(args);
  const result = await args.client.query({
    tenantId: args.tenantId,
    sql: query.sql,
    params: query.params,
  });

  return decode(SPAN_ROLLUP_COLUMNS, result).map((row) => ({
    bucketStartMs: Number(row.BucketStartMs),
    model: String(row.Model),
    spanType: String(row.SpanType),
    spanCount: Number(row.SpanCount),
    traceCount: Number(row.TraceCount),
    errorCount: Number(row.ErrorCount),
    costSum: roundCost(Number(row.CostSum)),
    nonBilledCostSum: roundCost(Number(row.NonBilledCostSum)),
    durationSumMs: Number(row.DurationSumMs),
    promptTokens: Number(row.PromptTokens),
    completionTokens: Number(row.CompletionTokens),
    cacheReadTokens: Number(row.CacheReadTokens),
    cacheWriteTokens: Number(row.CacheWriteTokens),
    reasoningTokens: Number(row.ReasoningTokens),
  }));
}

function acceptedAtPredicate(
  names: ReturnType<typeof bindIdentifiers>,
  prefix: string,
  range: AcceptedAtRange | undefined,
): string {
  if (!range) return "";
  const column = `${prefix}${names.of("AcceptedAt")}`;
  return (
    `AND ${column} >= {acceptedAtFrom:DateTime64(3)} ` +
    `AND ${column} <= {acceptedAtTo:DateTime64(3)} `
  );
}

function rangeParams(
  range: AcceptedAtRange | undefined,
): Record<string, string> {
  if (!range) return {};
  return {
    acceptedAtFrom: range.from.toISOString(),
    acceptedAtTo: range.to.toISOString(),
  };
}

type DecodedRow = Readonly<Record<string, unknown>>;

function decode(
  columns: Readonly<Record<string, AnyColumnDef>>,
  result: ClickHouseQueryResult,
): DecodedRow[] {
  const columnNames = Object.keys(columns);
  return createRowCodec().decodeRows<DecodedRow>({
    columns: columnNames.map((name) => columns[name]!),
    columnNames,
    header: result.header,
    rows: result.rows,
  });
}
