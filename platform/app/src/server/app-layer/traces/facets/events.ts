import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "../facet-registry";
import {
  EVENT_METRIC_SEP,
  EVENT_METRICS_PREFIX,
} from "../query-language/eventMetrics";
import { baseParams, buildTimeWhere, KEY_DISCOVERY_SETTINGS } from "./helpers";

export { EVENT_METRIC_SEP, EVENT_METRICS_PREFIX };

/** Per-event cap on (metric key, value) buckets returned to the sidebar. */
const METRIC_VALUES_TOP_N = 10;

/**
 * Span event names + per-event metric value aggregates. Each `stored_spans`
 * row carries parallel arrays `Events.Name` / `Events.Attributes`; the metric
 * entries are zipped with their event names before exploding via `arrayJoin`,
 * so every metric entry stays scoped to the event that emitted it.
 *
 * The metric buckets ride the SAME discover query (evaluator-facet
 * precedent) so the drilldown renders with zero extra queries per click.
 * Values are aggregated as stored, as verbatim strings that are never reformatted,
 * so a click round-trips exactly into `event.attribute.event.metrics.<k>:<v>`.
 *
 * The two halves read stored_spans separately, because they need very
 * different amounts of it:
 *
 *  - The name counts need only `Events.Name`, an
 *    `Array(LowCardinality(String))`.
 *  - The metric buckets need the values of `Events.Attributes`, an
 *    `Array(Map(LowCardinality(String), String))` that routinely carries
 *    captured payloads, but only on the minority of spans whose events carry
 *    an `event.metrics.` key at all.
 *
 * Reading them in one pass would materialise that map, values included, for
 * every span in the window just to count names. Instead the metrics half is
 * gated on the map's `.keys` subcolumn, which reaches PREWHERE and never opens
 * the values column, so the values are read only for spans that can
 * contribute a bucket. The gate is written as an explicit PREWHERE rather than
 * left for the optimizer to move there, so the saving does not depend on
 * `optimize_move_to_prewhere` or on how the optimizer ranks the conditions. It
 * is per granule, not per span: a granule holding one metric-bearing span still
 * reads every payload beside it. A span without such a key contributes nothing
 * to `sumMap` in either shape, so the gate cannot change a bucket.
 *
 * The facet key is `event` (matching the search-bar field) so toggles
 * round-trip cleanly with the `event:` filter handler.
 */
export function buildEventsFacetQuery(ctx: FacetQueryContext): FacetQuery {
  const where = buildTimeWhere("StartTime", ctx);
  const prefixFilter = ctx.prefix
    ? "AND lower(name) ILIKE concat({prefix:String}, '%')"
    : "";
  return {
    sql: `
      SELECT
        names.name AS facet_value,
        names.cnt AS cnt,
        arraySlice(
          arrayReverseSort(
            x -> x.2,
            arrayZip(metrics.metric_buckets.1, metrics.metric_buckets.2)
          ),
          1, ${METRIC_VALUES_TOP_N}
        ) AS metric_values,
        count() OVER () AS total_distinct
      FROM (
        SELECT name, count() AS cnt
        FROM (
          SELECT arrayJoin(\`Events.Name\`) AS name
          FROM stored_spans
          WHERE ${where}
            AND length(\`Events.Name\`) > 0
        )
        WHERE name != ''
          ${prefixFilter}
        GROUP BY name
      ) AS names
      LEFT JOIN (
        SELECT
          name,
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
            PREWHERE ${where}
              AND arrayExists(
                keys -> arrayExists(k -> startsWith(k, '${EVENT_METRICS_PREFIX}'), keys),
                \`Events.Attributes\`.keys
              )
          )
          WHERE ev.1 != ''
        )
        WHERE 1 = 1
          ${prefixFilter}
        GROUP BY name
      ) AS metrics ON names.name = metrics.name
      ORDER BY cnt DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    params: {
      ...baseParams(ctx),
      ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
    },
    settings: {
      // The gate above is what keeps this under the ceiling; the spill and
      // cap stay as the backstop for a window where most spans do carry
      // metrics.
      ...KEY_DISCOVERY_SETTINGS,
      // An event name with no metric entries has no row on the right side.
      // With nulls off it reads as an empty bucket tuple, which is what the
      // single-pass shape returned for it and what the sidebar expects.
      join_use_nulls: "0",
    },
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
