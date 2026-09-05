import type { ExpressionCategoricalDef } from "./trace-facet-registry.clickhouse.adapter";

/**
 * OTel status: wire-level StatusCode is Nullable(UInt8) — 0/NULL=unset, 1=ok, 2=error. Surfacing the human label (not the integer) as the facet value lets saved queries round-trip as spanStatus:error, matching the search-bar's FIELD_VALUES.spanStatus. A NULL comparison yields NULL, not 'unset', so a NULL-status span would drop out of the filter entirely — coalesce before comparing to agree with spanStatusRead.
 */
const STATUS_EXPRESSION =
  "if(ifNull(StatusCode, 0) = 2, 'error', if(ifNull(StatusCode, 0) = 1, 'ok', 'unset'))";

export class ClickHouseSpanStatusFacetAdapter {
  static create(): ClickHouseSpanStatusFacetAdapter {
    return new ClickHouseSpanStatusFacetAdapter();
  }

  /**
   * Span Status facet: OTel status of any span on the trace. Cross-table categorical against stored_spans, auto-translated into an IN-tuple subquery joined on TraceId — no rollup column on trace_summaries today; if latency ever matters, add a ContainsErrorSpanStatus flag at ingest rather than a faster ad-hoc query.
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
