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

/**
 * Display names for predefined-event metric values whose stored form is a
 * bare number nobody reads as meaning anything. `thumbs_up_down.vote` is
 * `1 | 0 | -1` on the wire (see `predefinedEvents.schema.ts`); a sidebar row
 * reading "-1" tells you nothing, "thumbs down" tells you everything.
 *
 * Display only. The filter clause, the value lookup and the round-trip all
 * keep the stored string exactly as ingest wrote it — this map never touches
 * the value that gets queried.
 */
const EVENT_METRIC_VALUE_LABELS: Record<string, Record<string, string>> = {
  "thumbs_up_down::event.metrics.vote": {
    "1": "thumbs up",
    "-1": "thumbs down",
    "0": "no vote",
  },
};

/**
 * The human name for a stored metric value, or the stored value itself when
 * there is nothing better to say — which is the case for every custom event
 * and every metric that isn't an opaque code.
 */
export function eventMetricValueLabel({
  eventType,
  metricKey,
  value,
}: {
  eventType: string;
  metricKey: string;
  value: string;
}): string {
  return (
    EVENT_METRIC_VALUE_LABELS[`${eventType}::${metricKey}`]?.[value] ?? value
  );
}
