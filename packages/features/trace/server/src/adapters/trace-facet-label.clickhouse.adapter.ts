import { ClickHouseFacetQueryAdapter } from "./trace-facet-query.clickhouse.adapter";
import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "./trace-facet-registry.clickhouse.adapter";

export class ClickHouseLabelFacetAdapter {
  static create(): ClickHouseLabelFacetAdapter {
    return new ClickHouseLabelFacetAdapter();
  }

  /**
   * Trace Label facet: every value of langwatch.labels, a JSON-encoded array of strings on trace_summaries.Attributes. Values arrive as '["foo","bar"]', so the query JSON-decodes and arrayJoins to expose individual labels, trimming quotes since JSONExtractArrayRaw returns the raw quoted form.
   */
  static buildLabelFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const where = ClickHouseFacetQueryAdapter.buildTimeWhere("OccurredAt");
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
        ...ClickHouseFacetQueryAdapter.baseParams(ctx),
        ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
      },
    };
  }
}

export const LABEL_FACET: QueryBuilderCategoricalDef = {
  key: "label",
  kind: "categorical",
  label: "Label",
  group: "trace",
  table: "trace_summaries",
  queryBuilder: ClickHouseLabelFacetAdapter.buildLabelFacetQuery,
};
