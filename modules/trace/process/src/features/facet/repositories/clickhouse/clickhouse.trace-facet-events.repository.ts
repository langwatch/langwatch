import { EVENT_METRICS_PREFIX } from "@langwatch/trace-contract";

import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "../../rules/trace-facet-registry.rules.ts";
import {
  ClickHouseTraceFacetQueryRepository,
  KEY_DISCOVERY_SETTINGS,
} from "./clickhouse.trace-facet-query.repository.ts";

/** Per-event cap on (metric key, value) buckets returned to the sidebar. */
const METRIC_VALUES_TOP_N = 10;

class ClickHouseTraceFacetEventsRepository {
  private constructor(private readonly facetQueries: ClickHouseTraceFacetQueryRepository) {}

  static create(): ClickHouseTraceFacetEventsRepository {
    return new ClickHouseTraceFacetEventsRepository(ClickHouseTraceFacetQueryRepository.create());
  }

  /** Event names with counts, joined to the metric buckets of events carrying `event.metrics.*`
   * keys. Names read `Events.Name` alone; the map is read only where its keys subcolumn holds
   * a metric key, gated in PREWHERE beside the tenant and window, so a granule without one never
   * opens the values. A search filter's trace-scope subquery runs once per half: it reads light
   * trace_summaries columns, cheap beside the heavy map a single pass would drag through the join. */
  buildEventsFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const where = this.facetQueries.buildTimeWhere("StartTime", ctx);
    const bounds = this.facetQueries.buildTimeWhere("StartTime");
    const traceScope = this.facetQueries.buildTraceScope("StartTime", ctx);
    const prefixFilter = ctx.prefix ? "AND lower(name) ILIKE concat({prefix:String}, '%')" : "";
    return {
      sql: `
        SELECT
          names.name AS facet_value,
          names.cnt AS cnt,
          arraySlice(
            arrayReverseSort(x -> x.2, arrayZip(metrics.metric_buckets.1, metrics.metric_buckets.2)),
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
              PREWHERE ${bounds}
                AND arrayExists(
                  keys -> arrayExists(k -> startsWith(k, '${EVENT_METRICS_PREFIX}'), keys),
                  \`Events.Attributes\`.keys
                )
              ${traceScope ? `WHERE ${traceScope}` : ""}
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
        ...this.facetQueries.baseParams(ctx),
        ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
      },
      settings: {
        // The metric-key gate keeps the read small; the spill (both GROUP BYs) and the cap
        // stay as the backstop. The join cannot spill and needs not: one row per event name.
        ...KEY_DISCOVERY_SETTINGS,
        // A name with no metric-bearing event misses the join and must read as an empty
        // bucket list, which is what the sidebar expects, not NULL.
        join_use_nulls: "0",
      },
    };
  }
}

const eventsFacetRepository = ClickHouseTraceFacetEventsRepository.create();

export const EVENT_FACET: QueryBuilderCategoricalDef = {
  key: "event",
  kind: "categorical",
  label: "Event name",
  group: "span",
  table: "stored_spans",
  queryBuilder: (ctx) => eventsFacetRepository.buildEventsFacetQuery(ctx),
};
