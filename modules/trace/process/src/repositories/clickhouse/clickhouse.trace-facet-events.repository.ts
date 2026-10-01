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

export class ClickHouseTraceFacetEventsRepository {
  private constructor(private readonly facetQueries: ClickHouseTraceFacetQueryRepository) {}

  static create(): ClickHouseTraceFacetEventsRepository {
    return new ClickHouseTraceFacetEventsRepository(ClickHouseTraceFacetQueryRepository.create());
  }

  /**
   * Discovers event names and their metric value aggregates in one query.
   */
  buildEventsFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const where = this.facetQueries.buildTimeWhere("StartTime", ctx);
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
        ...this.facetQueries.baseParams(ctx),
        ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
      },
      // Zipping + flattening Events.Attributes over the whole window is the
      // same shape that tripped MEMORY_LIMIT_EXCEEDED for the key-discovery
      // facets — the spill + memory-cap guard is mandatory here too.
      settings: KEY_DISCOVERY_SETTINGS,
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
