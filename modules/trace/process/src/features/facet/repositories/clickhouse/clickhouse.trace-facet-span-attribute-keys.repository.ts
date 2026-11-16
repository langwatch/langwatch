import { cond, fn } from "@langwatch/clickhouse-client/builder";

import { storedSpans } from "../../../../repositories/clickhouse/clickhouse.stored-spans.table.ts";
import type {
  DynamicKeysDef,
  FacetQuery,
  FacetQueryContext,
} from "../../rules/trace-facet-registry.rules.ts";
import { ClickHouseTraceFacetQueryRepository } from "./clickhouse.trace-facet-query.repository.ts";
import { FACET_SOURCES, facetRows, facetScopeOf } from "./clickhouse.trace-facet-scope.mapper.ts";

class ClickHouseTraceFacetSpanAttributeKeysRepository {
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
    const scope = facetScopeOf(ctx);
    const keys = fn.mapKeys(storedSpans.SpanAttributes);
    const rows = facetRows({ source: FACET_SOURCES.stored_spans, scan: ctx, scope })
      .where(() => cond.gt(fn.length(keys), 0), { inElection: false })
      .select({ key: fn.arrayJoin(keys) })
      .as("keys");
    return this.facetQueries.countedValues({
      scope,
      rows,
      value: rows.key,
      where: cond.and(
        cond.ne(rows.key, ""),
        cond.not(fn.startsWith(rows.key, "langwatch.reserved.")),
      ),
      ctx,
    });
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
