import { ClickHouseFacetQueryAdapter } from "./trace-facet-query.clickhouse.adapter";
import type {
  DynamicKeysDef,
  FacetQuery,
  FacetQueryContext,
} from "./trace-facet-registry.clickhouse.adapter";
import { KEY_DISCOVERY_SETTINGS } from "./trace-facet-query.clickhouse.adapter";

export class ClickHouseMetadataKeysFacetAdapter {
  static create(): ClickHouseMetadataKeysFacetAdapter {
    return new ClickHouseMetadataKeysFacetAdapter();
  }

  /**
   * Discover query for trace metadata attribute keys on trace_summaries.Attributes, mirroring buildSpanAttributeKeysFacetQuery's shape but against the trace table — run independently so the sidebar renders separate sections without one query masking the other on failure. The filter side is handled in filter-to-clickhouse/ast.ts.
   */
  static buildMetadataKeysFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const where = ClickHouseFacetQueryAdapter.buildTimeWhere("OccurredAt");
    const prefixFilter = ctx.prefix ? "AND lower(key) ILIKE concat({prefix:String}, '%')" : "";

    // Same I/O optimisation as `span-attribute-keys.ts`: stay entirely on the
    // keys subcolumn so the values side of the Map never gets loaded. The
    // empty-map short-circuit probes `Attributes.keys`, not `Attributes` —
    // `length(Attributes)` would materialise the whole Map (keys and values)
    // just to count entries, pulling the heavy values column into memory.
    return {
      sql: `
        SELECT
          key AS facet_value,
          count() AS cnt,
          count() OVER () AS total_distinct
        FROM (
          SELECT arrayJoin(Attributes.keys) AS key
          FROM trace_summaries
          WHERE ${where}
            AND length(Attributes.keys) > 0
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

  /**
   * Metadata-scoped sibling of {@link ClickHouseMetadataKeysFacetAdapter.buildMetadataKeysFacetQuery}: forces the metadata. namespace onto the prefix so discovery surfaces ONLY metadata.<name> keys, never bare trace attributes. A user sub-search is still honoured by appending it after the namespace.
   */
  static buildTraceMetadataKeysFacetQuery(ctx: FacetQueryContext): FacetQuery {
    return ClickHouseMetadataKeysFacetAdapter.buildMetadataKeysFacetQuery({
      ...ctx,
      prefix: `metadata.${ctx.prefix ?? ""}`,
    });
  }
}

export const METADATA_KEYS_FACET: DynamicKeysDef = {
  key: "metadataKeys",
  kind: "dynamic_keys",
  label: "Trace attribute keys",
  group: "metadata",
  table: "trace_summaries",
  queryBuilder: ClickHouseMetadataKeysFacetAdapter.buildMetadataKeysFacetQuery,
};

export const TRACE_METADATA_FACET: DynamicKeysDef = {
  key: "metadata",
  kind: "dynamic_keys",
  label: "Metadata",
  group: "trace",
  table: "trace_summaries",
  queryBuilder: ClickHouseMetadataKeysFacetAdapter.buildTraceMetadataKeysFacetQuery,
};
