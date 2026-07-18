/**
 * charts-proto — adapter from the REAL trace-query engine (spike #5670,
 * `server/app-layer/traces/trace-query/`) into the prototype's `StubResult`
 * shape.
 *
 * `stubData.ts` names the seam this fills: `runStubQuery` -> `traceQuery.run`.
 * This module builds the real request from a WidgetSpec and adapts the flat
 * row array `api.traceQuery.run` returns back into the shape WidgetRenderer
 * already consumes. No RNG, no sampling -- every number here came from a real
 * tenant-scoped ClickHouse query.
 *
 * Not supported yet (real allowlist limitations, not bugs here):
 *  - Line viz: the real engine has no time-bucket dimension (β design doc,
 *    "no time-bucket dimension" limitation) -- callers must gate this out.
 *  - Delta vs. previous period: would need a second real query; omitted for
 *    now, so `total.deltaPct` is always 0 (renders neutral, not fabricated).
 */
import { getHexColorForString } from "~/utils/rotatingColors";
import {
  aggAlias,
  aggLabel,
  isAdditiveAgg,
  type AggregationSpec,
  type DimensionColumn,
  type WidgetSpec,
} from "./model";
import type { StubColumn, StubGroup, StubResult, StubWindow } from "./stubData";

export interface RealTraceQueryRequest {
  aggregations: Array<AggregationSpec & { alias: string }>;
  groupBy?: DimensionColumn[];
  filter?: string;
  timeRange: { from: number; to: number };
  limit: number;
}

export const buildTraceQueryRequest = (
  spec: WidgetSpec,
  win: StubWindow,
): RealTraceQueryRequest => ({
  aggregations: spec.aggregations.map((agg, i) => ({
    ...agg,
    alias: aggAlias(agg, i),
  })),
  groupBy: spec.groupBy.length ? spec.groupBy : undefined,
  filter: spec.filter.trim() ? spec.filter.trim() : undefined,
  timeRange: { from: win.startDate.getTime(), to: win.endDate.getTime() },
  limit: 100,
});

const dimensionLabel = (dim: DimensionColumn, raw: string): string => {
  if (dim === "hasError") return raw === "true" || raw === "1" ? "Error" : "OK";
  return raw;
};

const dimensionColumnLabel = (dim: DimensionColumn): string =>
  dim === "model" ? "Model" : dim === "topicId" ? "Topic" : "Error status";

/** Adapts real TRQL rows (keyed by dimension name / explicit alias) into a StubResult. */
export const rowsToWidgetResult = (
  spec: WidgetSpec,
  rows: Array<Record<string, unknown>>,
): StubResult => {
  const columns: StubColumn[] = [
    ...spec.groupBy.map((dim) => ({
      key: dim,
      label: dimensionColumnLabel(dim),
      kind: "dimension" as const,
    })),
    ...spec.aggregations.map((agg, i) => ({
      key: aggAlias(agg, i),
      label: aggLabel(agg),
      kind: "metric" as const,
      agg,
    })),
  ];

  const groups: StubGroup[] = rows.map((row, i) => {
    const dims: Record<string, string> = {};
    for (const dim of spec.groupBy) {
      dims[dim] = dimensionLabel(dim, String(row[dim] ?? ""));
    }
    const label = spec.groupBy.length
      ? spec.groupBy.map((d) => dims[d]).join(" · ")
      : "All traces";
    const key = spec.groupBy.length
      ? spec.groupBy.map((d) => `${d}:${dims[d]}`).join("|")
      : `row_${i}`;
    const values: Record<string, number> = {};
    spec.aggregations.forEach((agg, j) => {
      const alias = aggAlias(agg, j);
      values[alias] = Number(row[alias] ?? 0);
    });
    return {
      key,
      label,
      color: getHexColorForString(label),
      dims,
      values,
    };
  });

  const primaryAgg = spec.aggregations[0] ?? { op: "count" as const };
  const primaryKey = aggAlias(primaryAgg, 0);
  groups.sort((a, b) => (b.values[primaryKey] ?? 0) - (a.values[primaryKey] ?? 0));

  const isAdditive = isAdditiveAgg(primaryAgg.op);
  const totalValue = isAdditive
    ? groups.reduce((s, g) => s + (g.values[primaryKey] ?? 0), 0)
    : groups.length
      ? groups.reduce((s, g) => s + (g.values[primaryKey] ?? 0), 0) / groups.length
      : 0;

  return {
    columns,
    groups,
    buckets: [],
    primaryAgg,
    total: { value: totalValue, deltaPct: 0, spark: [] },
  };
};
