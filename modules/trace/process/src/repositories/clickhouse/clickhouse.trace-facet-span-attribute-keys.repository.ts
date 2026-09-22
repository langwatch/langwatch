import {
  ClickHouseTraceFacetQueryRepository,
  KEY_DISCOVERY_SETTINGS,
} from "./clickhouse.trace-facet-query.repository.ts";
import type {
  DynamicKeysDef,
  FacetQuery,
  FacetQueryContext,
} from "./clickhouse.trace-facet-registry.repository.ts";

export class ClickHouseTraceFacetSpanAttributeKeysRepository {
  private constructor(private readonly facetQueries: ClickHouseTraceFacetQueryRepository) {}

  static create(): ClickHouseTraceFacetSpanAttributeKeysRepository {
    return new ClickHouseTraceFacetSpanAttributeKeysRepository(
      ClickHouseTraceFacetQueryRepository.create(),
    );
  }

  /**
   * Discovers span attribute keys ordered by frequency, reading keys only.
   */
  buildSpanAttributeKeysFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const where = this.facetQueries.buildTimeWhere("StartTime", ctx);
    const prefixFilter = ctx.prefix ? "AND lower(key) ILIKE concat({prefix:String}, '%')" : "";

    return {
      sql: `
        SELECT
          key AS facet_value,
          count() AS cnt,
          count() OVER () AS total_distinct
        FROM (
          SELECT arrayJoin(SpanAttributes.keys) AS key
          FROM stored_spans
          WHERE ${where}
            AND length(SpanAttributes.keys) > 0
        )
        WHERE key != ''
          AND NOT startsWith(key, 'langwatch.reserved.')
          ${prefixFilter}
        GROUP BY key
        ORDER BY cnt DESC
        LIMIT {limit:UInt32} OFFSET {offset:UInt32}
      `,
      params: {
        ...this.facetQueries.baseParams(ctx),
        ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
      },
      settings: KEY_DISCOVERY_SETTINGS,
    };
  }
}

const spanAttributeKeysFacetRepository = ClickHouseTraceFacetSpanAttributeKeysRepository.create();

export const SPAN_ATTRIBUTE_KEYS_FACET: DynamicKeysDef = {
  key: "spanAttributeKeys",
  kind: "dynamic_keys",
  label: "Span attribute keys",
  group: "span",
  table: "stored_spans",
  queryBuilder: (ctx) => spanAttributeKeysFacetRepository.buildSpanAttributeKeysFacetQuery(ctx),
};
