/**
 * A query's series split into parts read on their own, and each part's rows renumbered back to
 * the query's series; the row parser merges the parts' rows by period, date and group key.
 */

import type { AnalyticsSeries } from "@langwatch/analytics-contract";

import type { TimeseriesQueryInput } from "./clickhouse.aggregation-builder.mapper.ts";
import { spanGroupedPartOf } from "./clickhouse.span-grouped-joined-timeseries-query.mapper.ts";
import { isSpanGrouping } from "./clickhouse.span-grouped-timeseries-query.mapper.ts";
import { specOf } from "./clickhouse.trace-summaries-timeseries-query.mapper.ts";

/** One part: its own query, and the query's index for each of its series. */
export type SeriesPart = { input: TimeseriesQueryInput; indexes: number[] };

const partOf = (input: TimeseriesQueryInput, indexes: number[]): SeriesPart => ({
  input: { ...input, series: indexes.map((index) => input.series[index]!) },
  indexes,
});

/**
 * Ruling 2a (Alex, 2026-11-16): a pipeline beside other series is read on its own, so main's
 * shared join no longer inflates it. Empty when the query has nothing to split.
 */
export function findPipelineParts(input: TimeseriesQueryInput): SeriesPart[] {
  const indexes = input.series.map((_, index) => index);
  const pipelines = indexes.filter((index) => input.series[index]!.pipeline);
  const rest = indexes.filter((index) => !input.series[index]!.pipeline);
  if (pipelines.length === 0 || rest.length === 0) return [];
  return [partOf(input, pipelines), partOf(input, rest)];
}

/** The query's series in one part per kind; empty when every series is of one kind. */
function partsBy(
  input: TimeseriesQueryInput,
  kindOf: (series: AnalyticsSeries, index: number) => string,
): SeriesPart[] {
  const kinds = new Map<string, number[]>();
  for (const [index, series] of input.series.entries()) {
    const kind = kindOf(series, index);
    kinds.set(kind, [...(kinds.get(kind) ?? []), index]);
  }
  return kinds.size < 2 ? [] : [...kinds.values()].map((indexes) => partOf(input, indexes));
}

/**
 * Rulings 4a and 1a (Alex, 2026-11-16, Risk 11.1): run metrics are read per run on their own,
 * under a span grouping or beside span metrics; under a span grouping, span metrics too.
 */
export function findRunParts(input: TimeseriesQueryInput): SeriesPart[] {
  if (isSpanGrouping(input.groupBy)) return partsBy(input, spanGroupedPartOf);
  return partsBy(input, (series, index) => {
    if (series.pipeline) return "pipeline";
    return specOf(series, index).joins.includes("evaluation_runs") ? "runs" : "rest";
  });
}

const SERIES_KEY = /^m(\d+)__/;

/** A part's rows with each series key (`m<i>__...`) renumbered to the query's index. */
export function renumberedRows(rows: readonly unknown[], indexes: number[]): unknown[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row as Record<string, unknown>).map(([key, value]) => {
        const match = SERIES_KEY.exec(key);
        if (!match) return [key, value];
        return [`m${indexes[Number(match[1])]}__${key.slice(match[0].length)}`, value];
      }),
    ),
  );
}
