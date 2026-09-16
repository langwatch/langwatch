import type { ExpressionCategoricalDef } from "./clickhouse.trace-facet-registry.repository.ts";

/**
 * OTel StatusCode to human labels; coalesce NULLs to match spanStatusRead behavior.
 */
const STATUS_EXPRESSION =
  "if(ifNull(StatusCode, 0) = 2, 'error', if(ifNull(StatusCode, 0) = 1, 'ok', 'unset'))";

export class ClickHouseSpanStatusFacetAdapter {
  static create(): ClickHouseSpanStatusFacetAdapter {
    return new ClickHouseSpanStatusFacetAdapter();
  }

  /**
   * Span Status facet: OTel status of any span via cross-table subquery.
   */
  static readonly SPAN_STATUS_FACET: ExpressionCategoricalDef = {
    key: "spanStatus",
    kind: "categorical",
    label: "Span status",
    group: "span",
    table: "stored_spans",
    expression: STATUS_EXPRESSION,
  };
}
