import { cond, fn } from "@langwatch/clickhouse-client/builder";

import { storedSpans } from "../../../../repositories/clickhouse/clickhouse.stored-spans.table.ts";
import type {
  DynamicKeysDef,
  FacetQuery,
  FacetQueryContext,
} from "../../rules/trace-facet-registry.rules.ts";
import { ClickHouseTraceFacetQueryRepository } from "./clickhouse.trace-facet-query.repository.ts";
import { FACET_SOURCES, facetRows, facetScopeOf } from "./clickhouse.trace-facet-scope.mapper.ts";

class ClickHouseTraceFacetEventAttributeKeysRepository {
  private constructor(private readonly facetQueries: ClickHouseTraceFacetQueryRepository) {}

  static create(): ClickHouseTraceFacetEventAttributeKeysRepository {
    return new ClickHouseTraceFacetEventAttributeKeysRepository(
      ClickHouseTraceFacetQueryRepository.create(),
    );
  }

  /**
   * Discovers event attribute keys by flattening per-event Maps.
   */
  buildEventAttributeKeysFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const scope = facetScopeOf(ctx);
    const events = storedSpans["Events.Attributes"];
    const rows = facetRows({ source: FACET_SOURCES.stored_spans, scan: ctx, scope })
      .where(() => cond.gt(fn.length(events), 0), { inElection: false })
      .select({ key: fn.arrayJoin(fn.mapKeys(fn.arrayJoin(events))) })
      .as("keys");
    return this.facetQueries.countedValues({
      scope,
      rows,
      value: rows.key,
      where: cond.ne(rows.key, ""),
      ctx,
    });
  }
}

const eventAttributeKeysFacetRepository = ClickHouseTraceFacetEventAttributeKeysRepository.create();

export const EVENT_ATTRIBUTE_KEYS_FACET: DynamicKeysDef = {
  key: "eventAttributeKeys",
  kind: "dynamic_keys",
  label: "Event attribute keys",
  group: "trace",
  table: "stored_spans",
  queryBuilder: (ctx) => eventAttributeKeysFacetRepository.buildEventAttributeKeysFacetQuery(ctx),
};
