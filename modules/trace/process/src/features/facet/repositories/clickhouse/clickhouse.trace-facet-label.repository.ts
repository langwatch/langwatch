import { cond, fn } from "@langwatch/clickhouse-client/builder";

import { traceSummaries } from "../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "../../rules/trace-facet-registry.rules.ts";
import { ClickHouseTraceFacetQueryRepository } from "./clickhouse.trace-facet-query.repository.ts";
import {
  FACET_SETTINGS,
  FACET_SOURCES,
  facetRows,
  facetScopeOf,
} from "./clickhouse.trace-facet-scope.mapper.ts";

class ClickHouseTraceFacetLabelRepository {
  private constructor(private readonly facetQueries: ClickHouseTraceFacetQueryRepository) {}

  static create(): ClickHouseTraceFacetLabelRepository {
    return new ClickHouseTraceFacetLabelRepository(ClickHouseTraceFacetQueryRepository.create());
  }

  /**
   * Discovers trace labels from the JSON-encoded langwatch.labels attribute.
   */
  buildLabelFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const scope = facetScopeOf(ctx);
    const labels = fn.mapGet(traceSummaries.Attributes, "langwatch.labels");
    const rows = facetRows({ source: FACET_SOURCES.trace_summaries, scan: ctx, scope })
      .where(() => cond.and(cond.ne(labels, ""), cond.ne(labels, "[]")), { inElection: false })
      .select({ label: fn.arrayJoin(fn.JSONExtractArrayRaw(labels)) })
      .as("labels");
    return this.facetQueries.countedValues({
      scope,
      rows,
      value: fn.trimBoth(rows.label, '"'),
      where: cond.and(cond.ne(rows.label, ""), cond.ne(rows.label, "null")),
      ctx,
      settings: FACET_SETTINGS,
    });
  }
}

const labelFacetRepository = ClickHouseTraceFacetLabelRepository.create();

export const LABEL_FACET: QueryBuilderCategoricalDef = {
  key: "label",
  kind: "categorical",
  label: "Label",
  group: "trace",
  table: "trace_summaries",
  queryBuilder: (ctx) => labelFacetRepository.buildLabelFacetQuery(ctx),
};
