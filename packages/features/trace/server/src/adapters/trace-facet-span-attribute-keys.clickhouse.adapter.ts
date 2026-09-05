import { ClickHouseFacetQueryAdapter } from "./trace-facet-query.clickhouse.adapter";
import type {
  DynamicKeysDef,
  FacetQuery,
  FacetQueryContext,
} from "./trace-facet-registry.clickhouse.adapter";
import { KEY_DISCOVERY_SETTINGS } from "./trace-facet-query.clickhouse.adapter";

export class ClickHouseSpanAttributeKeysFacetAdapter {
  static create(): ClickHouseSpanAttributeKeysFacetAdapter {
    return new ClickHouseSpanAttributeKeysFacetAdapter();
  }

  /**
   * Discover query for span attribute keys, ordered by frequency — a key list, not a (key,value) cross-product, since values load lazily via facetValues once a key expands (a full value enumeration would be unbounded). SpanAttributes.keys reads only the keys subcolumn, skipping the (often large) values column; the empty-map check probes .keys too, never length(SpanAttributes), which would materialise the whole Map into memory and risk MEMORY_LIMIT_EXCEEDED. Filtering is wired through filter-to-clickhouse/ast.ts; this only feeds discovery.
   */
  static buildSpanAttributeKeysFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const where = ClickHouseFacetQueryAdapter.buildTimeWhere("StartTime");
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
        ...ClickHouseFacetQueryAdapter.baseParams(ctx),
        ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
      },
      settings: KEY_DISCOVERY_SETTINGS,
    };
  }
}

export const SPAN_ATTRIBUTE_KEYS_FACET: DynamicKeysDef = {
  key: "spanAttributeKeys",
  kind: "dynamic_keys",
  label: "Span attribute keys",
  group: "span",
  table: "stored_spans",
  queryBuilder: ClickHouseSpanAttributeKeysFacetAdapter.buildSpanAttributeKeysFacetQuery,
};
