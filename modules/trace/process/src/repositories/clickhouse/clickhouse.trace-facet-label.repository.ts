import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "../../rules/trace-facet-registry.rules.ts";
import { ClickHouseTraceFacetQueryRepository } from "./clickhouse.trace-facet-query.repository.ts";

export class ClickHouseTraceFacetLabelRepository {
  private constructor(private readonly facetQueries: ClickHouseTraceFacetQueryRepository) {}

  static create(): ClickHouseTraceFacetLabelRepository {
    return new ClickHouseTraceFacetLabelRepository(ClickHouseTraceFacetQueryRepository.create());
  }

  /**
   * Discovers trace labels from the JSON-encoded langwatch.labels attribute.
   */
  buildLabelFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const where = this.facetQueries.buildTimeWhere("OccurredAt", ctx);
    const prefixFilter = ctx.prefix
      ? "AND lower(trim(BOTH '\"' FROM label)) ILIKE concat({prefix:String}, '%')"
      : "";

    return {
      sql: `
        SELECT
          trim(BOTH '"' FROM label) AS facet_value,
          count() AS cnt,
          count() OVER () AS total_distinct
        FROM (
          SELECT arrayJoin(JSONExtractArrayRaw(Attributes['langwatch.labels'])) AS label
          FROM trace_summaries
          WHERE ${where}
            AND Attributes['langwatch.labels'] != ''
            AND Attributes['langwatch.labels'] != '[]'
        )
        WHERE label != '' AND label != 'null'
          ${prefixFilter}
        GROUP BY facet_value
        ORDER BY cnt DESC
        LIMIT {limit:UInt32} OFFSET {offset:UInt32}
      `,
      params: {
        ...this.facetQueries.baseParams(ctx),
        ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
      },
    };
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
