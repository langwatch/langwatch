import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "../facet-registry";
import { baseParams, buildTimeWhere } from "./helpers";

/**
 * Trace Label facet: every value of `langwatch.labels` (a JSON-encoded array
 * of strings stored on `trace_summaries.Attributes`).
 *
 * The values arrive as `'["foo","bar"]'`, so the query has to JSON-decode
 * and `arrayJoin` to expose individual labels. Trim quotes off each value
 * since `JSONExtractArrayRaw` returns the raw quoted form.
 */
export function buildLabelFacetQuery(ctx: FacetQueryContext): FacetQuery {
  const where = buildTimeWhere("OccurredAt");
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
      ...baseParams(ctx),
      ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
    },
  };
}

export const LABEL_FACET: QueryBuilderCategoricalDef = {
  key: "label",
  kind: "categorical",
  label: "Label",
  group: "trace",
  table: "trace_summaries",
  queryBuilder: buildLabelFacetQuery,
};
