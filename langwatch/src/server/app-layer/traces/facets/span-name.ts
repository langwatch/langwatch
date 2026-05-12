import type { ExpressionCategoricalDef } from "../facet-registry";

/**
 * Span Name facet: every distinct `SpanName` seen on `stored_spans`.
 *
 * Surfaced as "this trace contains a span named X" — the registry's
 * cross-table categorical translator (`crossTableStringEquality`) handles
 * the join back to `trace_summaries`, so adding the def is enough; no
 * custom filter handler is required.
 *
 * `SpanName` is a `LowCardinality(String)`, so equality is cheap and the
 * top-N discovery query stays well within budget without any precomputed
 * roll-up on the trace side.
 */
export const SPAN_NAME_FACET: ExpressionCategoricalDef = {
  key: "spanName",
  kind: "categorical",
  label: "Span name",
  group: "span",
  table: "stored_spans",
  expression: "SpanName",
};
