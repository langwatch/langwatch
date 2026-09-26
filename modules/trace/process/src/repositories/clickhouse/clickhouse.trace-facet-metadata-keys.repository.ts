import type {
  DynamicKeysDef,
  FacetQuery,
  FacetQueryContext,
} from "../../rules/trace-facet-registry.rules.ts";
import {
  ClickHouseTraceFacetQueryRepository,
  KEY_DISCOVERY_SETTINGS,
} from "./clickhouse.trace-facet-query.repository.ts";

export class ClickHouseTraceFacetMetadataKeysRepository {
  private constructor(private readonly facetQueries: ClickHouseTraceFacetQueryRepository) {}

  static create(): ClickHouseTraceFacetMetadataKeysRepository {
    return new ClickHouseTraceFacetMetadataKeysRepository(
      ClickHouseTraceFacetQueryRepository.create(),
    );
  }

  /**
   * Discovers metadata attribute keys on the trace table.
   */
  buildMetadataKeysFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const where = this.facetQueries.buildTimeWhere("OccurredAt", ctx);
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
        ...this.facetQueries.baseParams(ctx),
        ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
      },
      settings: KEY_DISCOVERY_SETTINGS,
    };
  }

  /**
   * Metadata-scoped variant forcing the metadata.* namespace on the prefix.
   */
  buildTraceMetadataKeysFacetQuery(ctx: FacetQueryContext): FacetQuery {
    return this.buildMetadataKeysFacetQuery({
      ...ctx,
      prefix: `metadata.${ctx.prefix ?? ""}`,
    });
  }
}

const metadataKeysFacetRepository = ClickHouseTraceFacetMetadataKeysRepository.create();

export const METADATA_KEYS_FACET: DynamicKeysDef = {
  key: "metadataKeys",
  kind: "dynamic_keys",
  label: "Trace attribute keys",
  group: "metadata",
  table: "trace_summaries",
  queryBuilder: (ctx) => metadataKeysFacetRepository.buildMetadataKeysFacetQuery(ctx),
};

export const TRACE_METADATA_FACET: DynamicKeysDef = {
  key: "metadata",
  kind: "dynamic_keys",
  label: "Metadata",
  group: "trace",
  table: "trace_summaries",
  queryBuilder: (ctx) => metadataKeysFacetRepository.buildTraceMetadataKeysFacetQuery(ctx),
};
