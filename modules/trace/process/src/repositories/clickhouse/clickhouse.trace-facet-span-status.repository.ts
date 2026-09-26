import type { ExpressionCategoricalDef } from "../../rules/trace-facet-registry.rules.ts";

/**
 * OTel StatusCode to human labels; coalesce NULLs to match spanStatusRead behavior.
 */
const STATUS_EXPRESSION =
  "if(ifNull(StatusCode, 0) = 2, 'error', if(ifNull(StatusCode, 0) = 1, 'ok', 'unset'))";

const SPAN_STATUS_FACET: ExpressionCategoricalDef = {
  key: "spanStatus",
  kind: "categorical",
  label: "Span status",
  group: "span",
  table: "stored_spans",
  expression: STATUS_EXPRESSION,
};

export class ClickHouseTraceFacetSpanStatusRepository {
  private constructor() {}

  static create(): ClickHouseTraceFacetSpanStatusRepository {
    return new ClickHouseTraceFacetSpanStatusRepository();
  }

  /**
   * Span Status facet: OTel status of any span via cross-table subquery.
   */
  getSpanStatusFacet(): ExpressionCategoricalDef {
    return SPAN_STATUS_FACET;
  }
}
