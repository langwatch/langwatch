/**
 * Which table a batched facet read scans: the facet table, or its light twin when the twin holds
 * the whole window and every facet in the batch has a column there.
 * @see specs/traces-v2/facet-light-twin.feature
 */

import { Temporal } from "@langwatch/time";
import type { FacetTableName, SpanAnalyticsFloor } from "@langwatch/trace-contract";

import type {
  ExpressionCategoricalDef,
  FacetCatalog,
  FacetTable,
  RangeFacetDef,
} from "./trace-facet-registry.rules.ts";

/** The table, time column and per-facet expression one batched read uses. */
export interface BatchedFacetSource {
  table: FacetTableName;
  timeColumn: string;
  expressionOf: (def: ExpressionCategoricalDef | RangeFacetDef) => string;
}

/** Whether the twin holds every row from `fromMs` on. */
export function twinCoversWindow({
  floor,
  fromMs,
}: {
  floor: SpanAnalyticsFloor | null;
  fromMs: number;
}): boolean {
  if (!floor || floor.rebuilding) return false;
  return floor.from === null || fromMs >= Temporal.Instant.from(floor.from).epochMilliseconds;
}

export function batchedFacetSource({
  catalog,
  table,
  categoricals,
  ranges,
  floor,
  fromMs,
}: {
  catalog: FacetCatalog;
  table: FacetTable;
  categoricals: readonly ExpressionCategoricalDef[];
  ranges: readonly RangeFacetDef[];
  /** Null when this process cannot tell where the twin starts; the facet table is read. */
  floor: SpanAnalyticsFloor | null;
  fromMs: number;
}): BatchedFacetSource {
  const own: BatchedFacetSource = {
    table,
    timeColumn: catalog.timeColumns[table],
    expressionOf: (def) => def.expression,
  };
  const twin = catalog.lightTwins?.[table];
  if (!twin || ranges.length > 0 || categoricals.length === 0) return own;
  if (categoricals.some((def) => def.lightExpression === undefined)) return own;
  if (!twinCoversWindow({ floor, fromMs })) return own;
  return {
    table: twin.table,
    timeColumn: twin.timeColumn,
    expressionOf: (def) =>
      ("lightExpression" in def ? def.lightExpression : undefined) ?? def.expression,
  };
}
