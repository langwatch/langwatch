import type { ExpressionCategoricalDef } from "./trace-facet-registry.clickhouse.adapter";

export class ClickHouseSpanNameFacetAdapter {
  static create(): ClickHouseSpanNameFacetAdapter {
    return new ClickHouseSpanNameFacetAdapter();
  }

  /**
   * Span Name facet: every distinct SpanName on stored_spans, surfaced as "this trace contains a span named X" — the registry's crossTableCategorical handles the join back to trace_summaries, so adding the def is enough, no custom filter handler needed. SpanName is LowCardinality(String), so equality is cheap and top-N discovery stays well within budget with no precomputed rollup.
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
