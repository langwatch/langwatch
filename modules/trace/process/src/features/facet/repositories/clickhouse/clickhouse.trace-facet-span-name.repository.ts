import type { ExpressionCategoricalDef } from "../../rules/trace-facet-registry.rules.ts";

const SPAN_NAME_FACET: ExpressionCategoricalDef = {
  key: "spanName",
  kind: "categorical",
  label: "Span name",
  group: "span",
  table: "stored_spans",
  expression: "SpanName",
};

export class ClickHouseTraceFacetSpanNameRepository {
  private constructor() {}

  static create(): ClickHouseTraceFacetSpanNameRepository {
    return new ClickHouseTraceFacetSpanNameRepository();
  }

  /**
   * Span Name facet: distinct SpanNames as "trace contains span named X".
   */
  getSpanNameFacet(): ExpressionCategoricalDef {
    return SPAN_NAME_FACET;
  }
}
