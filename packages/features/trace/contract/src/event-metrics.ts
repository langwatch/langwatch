/**
 * The wire-format contract for event metric attributes, shared by the facet
 * SQL that produces them, the repository mapper that decodes them, and the
 * sidebar drilldown that displays them. One definition, because SQL writes
 * the prefix and separator and the UI strips them back off.
 */

/**
 * Prefix the ingest mapper gives event metric attributes: a thumbs_up_down
 * event's vote lands as `Events.Attributes['event.metrics.vote']`. Only these
 * entries feed the per-event drilldown.
 */
export const EVENT_METRICS_PREFIX = "event.metrics.";

/**
 * Composite-key separator for the metric buckets: `sumMap` needs scalar keys,
 * so (metric key, stored value) pairs are joined with the ASCII unit
 * separator (0x1F). The SQL emits it via `char(31)`; the facet-row mapper
 * splits on this constant. Ingest rejects keys carrying it.
 */
export const EVENT_METRIC_SEP = String.fromCharCode(31);

/**
 * Display names for predefined-event metric values whose stored form is a
 * bare number nobody reads as meaning anything. Display only — the filter
 * clause and the value lookup keep the stored string exactly as ingest
 * wrote it.
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
 * there is nothing better to say.
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
  return EVENT_METRIC_VALUE_LABELS[`${eventType}::${metricKey}`]?.[value] ?? value;
}
