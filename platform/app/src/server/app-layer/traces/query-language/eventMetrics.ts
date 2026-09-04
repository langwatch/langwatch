/**
 * The wire-format contract for event metric attributes, shared by the facet
 * SQL that produces them, the repository mapper that decodes them, and the
 * sidebar drilldown that displays them. It lives in `query-language/` because
 * that is the framework-free module both layers already import from — the
 * drilldown reads `getFacetValueState` from here, the facet builder reads the
 * grammar.
 *
 * Keeping one definition matters because the two halves are read apart: SQL
 * writes the prefix and the separator, and the UI strips them back off. A
 * second literal drifting by one character silently empties the drilldown.
 */

/**
 * Prefix the ingest mapper gives event metric attributes (see
 * `event-attrs.mapper.ts`): a thumbs_up_down event's vote lands as
 * `Events.Attributes['event.metrics.vote']`. Only these entries feed the
 * per-event drilldown — non-metric attributes stay in the Event attributes
 * section.
 */
export const EVENT_METRICS_PREFIX = "event.metrics.";

/**
 * Composite-key separator for the metric buckets: `sumMap` needs scalar keys,
 * so (metric key, stored value) pairs are joined with the ASCII unit
 * separator (0x1F) — a control char that can't appear in either half. The
 * SQL emits it via `char(31)`; the repository's facet-row mapper splits on
 * this constant.
 */
export const EVENT_METRIC_SEP = String.fromCharCode(31);
