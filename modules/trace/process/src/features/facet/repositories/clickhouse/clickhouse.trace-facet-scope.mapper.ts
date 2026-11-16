/**
 * A facet table's rows as every facet read counts them: in the proof's windows and the time
 * range, narrowed by the trace filter compiled for the read's own scope (ADR-139, ADR-202).
 */
import type { Authorization } from "@langwatch/authorization";
import {
  type ClickHouseRead,
  type ClickHouseReadStart,
  type ClickHouseTable,
  clickhouseRead,
  type ColumnsSpec,
  cond,
  type Expression,
  fn,
  type ProofScope,
  type ReaderScope,
  tenantScope as builtTenantScope,
} from "@langwatch/clickhouse-client/builder";
import type { FacetTableName } from "@langwatch/trace-contract";

import { evaluationRuns } from "../../../../repositories/clickhouse/clickhouse.evaluation-runs.table.ts";
import { storedSpans } from "../../../../repositories/clickhouse/clickhouse.stored-spans.table.ts";
import { traceSummaries as ts } from "../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import {
  electedSummaries,
  filterTerm,
  isLiveUpperBound,
} from "../../../../repositories/clickhouse/clickhouse.trace-summary-election.mapper.ts";
import type {
  TraceFilterCompilation,
  TraceFilterCompile,
} from "../../../query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";
import {
  FACET_CATEGORICAL_EXPRESSIONS,
  FACET_RANGE_EXPRESSIONS,
} from "./clickhouse.trace-facet-expressions.mapper.ts";

/** Seconds a sidebar facet read may run before ClickHouse stops it. */
export const FACET_READ_MAX_EXECUTION_SECONDS = 20;

/**
 * Every sidebar facet read is stopped on the server at its time cap and not run again, under a
 * 2 GiB memory cap. The sidebar omits a stopped facet. specs/traces-v2/search.feature
 */
/** The facet time and memory cap as a SETTINGS clause on a built facet read. */
export const FACET_SETTINGS = {
  max_execution_time: FACET_READ_MAX_EXECUTION_SECONDS,
  timeout_overflow_mode: "throw",
  max_memory_usage: 2 * 1024 * 1024 * 1024,
} as const;

export type FacetWindow = { from: number; to: number; live?: boolean };

/** One facet read's proof, window and filter; the filter is compiled for the read's own scope. */
export type FacetScan = FacetRowsScan & { table: FacetTableName };

/** A facet read's proof, window and filter, apart from its table. */
export type FacetRowsScan = {
  authorization: Authorization;
  timeRange: FacetWindow;
  compileFilter?: TraceFilterCompile;
};

/**
 * A facet table's read: its descriptor, its window column, its facets' expressions, and how the
 * trace filter narrows its rows (on `trace_summaries` after the election; elsewhere by the
 * (tenant, trace) pairs whose latest summary in the window matches, ADR-139).
 */
export interface FacetSource<Name extends FacetTableName, Columns extends ColumnsSpec> {
  table: ClickHouseTable<Name, Columns>;
  time: Expression<unknown, Name>;
  categorical: Readonly<Record<string, Expression<string | null, Name>>>;
  range: Readonly<Record<string, Expression<number | null, Name>>>;
  narrow: <Row extends Record<string, unknown>>(
    read: ClickHouseRead<ProofScope, Name, Row, Record<never, never>>,
    filter: { timeRange: FacetWindow; compiled: TraceFilterCompilation | undefined },
  ) => ClickHouseRead<ProofScope, Name, Row, Record<never, never>>;
}

function facetSource<Name extends FacetTableName, Columns extends ColumnsSpec>(
  source: FacetSource<Name, Columns>,
): FacetSource<Name, Columns> {
  return source;
}

/** The (tenant, trace) pairs whose latest summary in the window matches the filter. */
function filteredTraceKeys<S extends ReaderScope>({
  start,
  timeRange,
  filter,
}: {
  start: ClickHouseReadStart<S>;
  timeRange: FacetWindow;
  filter: TraceFilterCompilation;
}) {
  return electedSummaries({ start, timeRange, filter })
    .select({ TenantId: ts.TenantId, TraceId: ts.TraceId })
    .latestVersion();
}

export const FACET_SOURCES = {
  trace_summaries: facetSource({
    table: ts,
    time: ts.OccurredAt,
    categorical: FACET_CATEGORICAL_EXPRESSIONS.trace_summaries,
    range: FACET_RANGE_EXPRESSIONS.trace_summaries,
    narrow: (read, { compiled }) =>
      read.where(filterTerm(compiled ?? { kind: "empty" }), { inElection: false }).latestVersion(),
  }),
  evaluation_runs: facetSource({
    table: evaluationRuns,
    time: evaluationRuns.ScheduledAt,
    categorical: FACET_CATEGORICAL_EXPRESSIONS.evaluation_runs,
    range: FACET_RANGE_EXPRESSIONS.evaluation_runs,
    narrow: (read, { timeRange, compiled }) =>
      compiled === undefined
        ? read
        : read.where(({ within }) =>
            within(fn.tuple(evaluationRuns.TenantId, evaluationRuns.TraceId), (sub) =>
              filteredTraceKeys({ start: sub, timeRange, filter: compiled }),
            ),
          ),
  }),
  stored_spans: facetSource({
    table: storedSpans,
    time: storedSpans.StartTime,
    categorical: FACET_CATEGORICAL_EXPRESSIONS.stored_spans,
    range: FACET_RANGE_EXPRESSIONS.stored_spans,
    narrow: (read, { timeRange, compiled }) =>
      compiled === undefined
        ? read
        : read.where(({ within }) =>
            within(fn.tuple(storedSpans.TenantId, storedSpans.TraceId), (sub) =>
              filteredTraceKeys({ start: sub, timeRange, filter: compiled }),
            ),
          ),
  }),
};

/** Runs `build` on the source of `table`, each typed by its own table. */
export function onFacetSource<R>(
  table: FacetTableName,
  build: <Name extends FacetTableName, Columns extends ColumnsSpec>(
    source: FacetSource<Name, Columns>,
  ) => R,
): R {
  switch (table) {
    case "trace_summaries":
      return build(FACET_SOURCES.trace_summaries);
    case "evaluation_runs":
      return build(FACET_SOURCES.evaluation_runs);
    case "stored_spans":
      return build(FACET_SOURCES.stored_spans);
  }
}

/** A facet's expression on its table; a key the registry does not give one is a defect. */
export function facetExpressionOf<V>(
  expressions: Readonly<Record<string, V>>,
  table: FacetTableName,
  key: string,
): V {
  const expression = expressions[key];
  if (expression === undefined) throw new Error(`No facet expression for ${table}.${key}`);
  return expression;
}

/** A facet read's proof scope; a derived read and the read over it share one. */
export function facetScopeOf(scan: Pick<FacetRowsScan, "authorization">): ProofScope {
  return builtTenantScope.fromProof({ authorization: scan.authorization, reads: "traces" });
}

/** The facet table's rows in the proof's windows and the time range, narrowed by the filter. */
export function facetRows<Name extends FacetTableName, Columns extends ColumnsSpec>({
  source,
  scan,
  scope = facetScopeOf(scan),
}: {
  source: FacetSource<Name, Columns>;
  scan: FacetRowsScan;
  scope?: ProofScope;
}): ClickHouseRead<ProofScope, Name, Record<never, never>, Record<never, never>> {
  const { time } = source;
  const read = clickhouseRead({ scope })
    .from(source.table)
    .withinWindows()
    .where(() => {
      const from = cond.gte(time, scan.timeRange.from);
      return isLiveUpperBound(scan.timeRange)
        ? from
        : cond.and(from, cond.lte(time, scan.timeRange.to));
    });
  return source.narrow(read, {
    timeRange: scan.timeRange,
    compiled: scan.compileFilter?.({ scope }),
  });
}
