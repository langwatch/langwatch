import { cond, fn } from "@langwatch/clickhouse-client/builder";

import { traceSummaries } from "../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import type {
  DynamicKeysDef,
  FacetQuery,
  FacetQueryContext,
} from "../../rules/trace-facet-registry.rules.ts";
import { ClickHouseTraceFacetQueryRepository } from "./clickhouse.trace-facet-query.repository.ts";
import { FACET_SOURCES, facetRows, facetScopeOf } from "./clickhouse.trace-facet-scope.mapper.ts";

class ClickHouseTraceFacetMetadataKeysRepository {
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
    const scope = facetScopeOf(ctx);
    // `mapKeys` reads the keys subcolumn only, so the Map's values are never loaded.
    const keys = fn.mapKeys(traceSummaries.Attributes);
    const rows = facetRows({ source: FACET_SOURCES.trace_summaries, scan: ctx, scope })
      .where(() => cond.gt(fn.length(keys), 0), { inElection: false })
      .select({ key: fn.arrayJoin(keys) })
      .as("keys");
    return this.facetQueries.countedValues({
      scope,
      rows,
      value: rows.key,
      where: cond.ne(rows.key, ""),
      ctx,
    });
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
