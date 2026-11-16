/**
 * A query's series split into parts read on their own, and each part's rows renumbered back to
 * the query's series; the row parser merges the parts' rows by period, date and group key.
 */

import type { TimeseriesQueryInput } from "./clickhouse.aggregation-builder.mapper.ts";

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
