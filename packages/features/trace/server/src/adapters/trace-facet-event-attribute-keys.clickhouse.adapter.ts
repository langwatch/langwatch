import { ClickHouseFacetQueryAdapter } from "./trace-facet-query.clickhouse.adapter";
import type {
  DynamicKeysDef,
  FacetQuery,
  FacetQueryContext,
} from "./trace-facet-registry.clickhouse.adapter";
import { KEY_DISCOVERY_SETTINGS } from "./trace-facet-query.clickhouse.adapter";

export class ClickHouseEventAttributeKeysFacetAdapter {
  static create(): ClickHouseEventAttributeKeysFacetAdapter {
    return new ClickHouseEventAttributeKeysFacetAdapter();
  }

  /**
   * Discover query for event attribute keys across stored_spans' Events.Attributes maps (Array(Map) per event per span, so this double-arrayJoins to flatten to one key column). Mirrors span-attribute-keys.ts: returns only the key list, values loaded lazily on expand, since a full (key,value) enumeration wouldn't scale against unbounded cardinality. Filtering itself is wired through translateEventAttribute; this only feeds the sidebar's discovery list.
   */
  static buildEventAttributeKeysFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const where = ClickHouseFacetQueryAdapter.buildTimeWhere("StartTime");
    const prefixFilter = ctx.prefix ? "AND lower(key) ILIKE concat({prefix:String}, '%')" : "";

    return {
      sql: `
        SELECT
          key AS facet_value,
          count() AS cnt,
          count() OVER () AS total_distinct
        FROM (
          SELECT arrayJoin(mapKeys(arrayJoin(\`Events.Attributes\`))) AS key
          FROM stored_spans
          WHERE ${where}
            AND length(\`Events.Attributes\`) > 0
        )
        WHERE key != ''
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

export const EVENT_ATTRIBUTE_KEYS_FACET: DynamicKeysDef = {
  key: "eventAttributeKeys",
  kind: "dynamic_keys",
  label: "Event attribute keys",
  group: "trace",
  table: "stored_spans",
  queryBuilder: ClickHouseEventAttributeKeysFacetAdapter.buildEventAttributeKeysFacetQuery,
};
