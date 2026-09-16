import { ClickHouseFacetQueryAdapter } from "./clickhouse.trace-facet-query.repository.ts";
import type {
  DynamicKeysDef,
  FacetQuery,
  FacetQueryContext,
} from "./clickhouse.trace-facet-registry.repository.ts";
import { KEY_DISCOVERY_SETTINGS } from "./clickhouse.trace-facet-query.repository.ts";

export class ClickHouseEventAttributeKeysFacetAdapter {
  static create(): ClickHouseEventAttributeKeysFacetAdapter {
    return new ClickHouseEventAttributeKeysFacetAdapter();
  }

  /**
   * Discovers event attribute keys by flattening per-event Maps.
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
