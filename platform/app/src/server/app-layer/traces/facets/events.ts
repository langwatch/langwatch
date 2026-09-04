import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "../facet-registry";
import { baseParams, buildTimeWhere, KEY_DISCOVERY_SETTINGS } from "./helpers";

/**
 * Prefix the ingest mapper gives event metric attributes (see
 * `event-attrs.mapper.ts`): a thumbs_up_down event's vote lands as
 * `Events.Attributes['event.metrics.vote']`. Only these entries feed the
 * per-event drilldown — non-metric attributes stay in the Event attributes
 * section.
 */
const EVENT_METRICS_PREFIX = "event.metrics.";

/**
 * Composite-key separator for the metric buckets: `sumMap` needs scalar keys,
 * so (metric key, stored value) pairs are joined with the ASCII unit
 * separator (0x1F) — a control char that can't appear in either half. The
 * SQL emits it via `char(31)`; the repo's facet-row mapper splits on this
 * constant.
 */
export const EVENT_METRIC_SEP = String.fromCharCode(31);

/** Per-event cap on (metric key, value) buckets returned to the sidebar. */
const METRIC_VALUES_TOP_N = 10;

/**
 * Span event names + per-event metric value aggregates. Each `stored_spans`
 * row carries parallel arrays `Events.Name` / `Events.Attributes`; we zip
 * them before exploding via `arrayJoin` so every metric entry stays scoped
 * to the event that emitted it, then group by name.
 *
 * The metric buckets ride the SAME discover query (evaluator-facet
 * precedent) so the drilldown renders with zero extra queries per click.
 * Values are aggregated as stored — verbatim strings, never reformatted —
 * so a click round-trips exactly into `event.attribute.event.metrics.<k>:<v>`.
 *
 * The facet key is `event` (matching the search-bar field) so toggles
 * round-trip cleanly with the `event:` filter handler.
 */
export function buildEventsFacetQuery(ctx: FacetQueryContext): FacetQuery {
  const where = buildTimeWhere("StartTime");
  const prefixFilter = ctx.prefix
    ? "AND lower(name) ILIKE concat({prefix:String}, '%')"
    : "";
  return {
    sql: `
      SELECT
        name AS facet_value,
        cnt,
        arraySlice(
          arrayReverseSort(x -> x.2, arrayZip(metric_buckets.1, metric_buckets.2)),
          1, ${METRIC_VALUES_TOP_N}
        ) AS metric_values,
        count() OVER () AS total_distinct
      FROM (
        SELECT
          name,
          count() AS cnt,
          sumMap(
            arrayMap(x -> concat(x.1, char(31), x.2), metric_entries),
            arrayMap(x -> toUInt64(1), metric_entries)
          ) AS metric_buckets
        FROM (
          SELECT
            ev.1 AS name,
            arrayFilter(
              x -> startsWith(x.1, '${EVENT_METRICS_PREFIX}') AND x.2 != '',
              arrayZip(mapKeys(ev.2), mapValues(ev.2))
            ) AS metric_entries
          FROM (
            SELECT arrayJoin(arrayZip(\`Events.Name\`, \`Events.Attributes\`)) AS ev
            FROM stored_spans
            WHERE ${where}
              AND length(\`Events.Name\`) > 0
          )
          WHERE ev.1 != ''
        )
        WHERE 1 = 1
          ${prefixFilter}
        GROUP BY name
      )
      ORDER BY cnt DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    params: {
      ...baseParams(ctx),
      ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
    },
    // Zipping + flattening Events.Attributes over the whole window is the
    // same shape that tripped MEMORY_LIMIT_EXCEEDED for the key-discovery
    // facets — the spill + memory-cap guard is mandatory here too.
    settings: KEY_DISCOVERY_SETTINGS,
  };
}

export const EVENT_FACET: QueryBuilderCategoricalDef = {
  key: "event",
  kind: "categorical",
  label: "Event name",
  group: "span",
  table: "stored_spans",
  queryBuilder: buildEventsFacetQuery,
};
