import { ClickHouseFacetQueryAdapter } from "./trace-facet-query.clickhouse.adapter";
import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "./trace-facet-registry.clickhouse.adapter";
import { EVENT_METRICS_PREFIX } from "@langwatch/trace-contract";
import { KEY_DISCOVERY_SETTINGS } from "./trace-facet-query.clickhouse.adapter";

/** Per-event cap on (metric key, value) buckets returned to the sidebar. */
const METRIC_VALUES_TOP_N = 10;

export class ClickHouseEventsFacetAdapter {
  static create(): ClickHouseEventsFacetAdapter {
    return new ClickHouseEventsFacetAdapter();
  }

  /**
   * Span event names + per-event metric value aggregates: zips stored_spans' parallel Events.Name/Events.Attributes arrays before arrayJoin-exploding, so each metric entry stays scoped to its event, then groups by name. Metric buckets ride the SAME discover query (evaluator-facet precedent) for zero extra queries per click, aggregated verbatim so a click round-trips exactly into event.attribute.event.metrics.<k>:<v>. Facet key is 'event' to match the search-bar field.
   */
  static buildEventsFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const where = ClickHouseFacetQueryAdapter.buildTimeWhere("StartTime");
    const prefixFilter = ctx.prefix ? "AND lower(name) ILIKE concat({prefix:String}, '%')" : "";
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
        ...ClickHouseFacetQueryAdapter.baseParams(ctx),
        ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
      },
      // Zipping + flattening Events.Attributes over the whole window is the
      // same shape that tripped MEMORY_LIMIT_EXCEEDED for the key-discovery
      // facets — the spill + memory-cap guard is mandatory here too.
      settings: KEY_DISCOVERY_SETTINGS,
    };
  }
}

export const EVENT_FACET: QueryBuilderCategoricalDef = {
  key: "event",
  kind: "categorical",
  label: "Event name",
  group: "span",
  table: "stored_spans",
  queryBuilder: ClickHouseEventsFacetAdapter.buildEventsFacetQuery,
};
