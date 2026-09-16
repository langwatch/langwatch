import type { ExpressionCategoricalDef } from "./clickhouse.trace-facet-registry.repository.ts";

export class ClickHouseSpanNameFacetAdapter {
  static create(): ClickHouseSpanNameFacetAdapter {
    return new ClickHouseSpanNameFacetAdapter();
  }

  /**
   * Span Name facet: distinct SpanNames as "trace contains span named X".
   */
  static readonly SPAN_NAME_FACET: ExpressionCategoricalDef = {
    key: "spanName",
    kind: "categorical",
    label: "Span name",
    group: "span",
    table: "stored_spans",
    expression: "SpanName",
  };
}
