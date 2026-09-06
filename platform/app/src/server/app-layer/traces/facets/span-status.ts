import type { ExpressionCategoricalDef } from "../facet-registry";

/**
 * OpenTelemetry status code mapping. The wire-level `StatusCode` is a
 * `Nullable(UInt8)`:
 *
 *   - `0` (or `NULL`) → unset (no explicit status reported)
 *   - `1`             → ok
 *   - `2`             → error
 *
 * Surfacing the human label as the facet value (rather than the integer)
 * means saved queries / lenses round-trip as `spanStatus:error` which
 * matches the user's mental model and the search-bar suggestions in
 * `FIELD_VALUES.spanStatus`.
 */
// `StatusCode` is Nullable(UInt8), and a comparison against NULL yields NULL —
// not the `'unset'` fallback — so a NULL-status span would drop out of the
// filter entirely instead of reading as unset. Coalesce before comparing, so
// this agrees with `spanStatusRead` and with the doc above.
const STATUS_EXPRESSION =
  "if(ifNull(StatusCode, 0) = 2, 'error', if(ifNull(StatusCode, 0) = 1, 'ok', 'unset'))";

/**
 * Span Status facet: surfaces the OTel status of any span on the trace.
 *
 * Cross-table categorical against `stored_spans` — auto-translated into
 * an `IN`-tuple subquery joining back on TraceId. There's no roll-up
 * column on `trace_summaries` for span-level status today; if discover
 * latency on this facet ever becomes a problem, the right move is a
 * `ContainsErrorSpanStatus` flag at ingest, not a faster ad-hoc query.
 */
export const SPAN_STATUS_FACET: ExpressionCategoricalDef = {
  key: "spanStatus",
  kind: "categorical",
  label: "Span status",
  group: "span",
  table: "stored_spans",
  expression: STATUS_EXPRESSION,
};
