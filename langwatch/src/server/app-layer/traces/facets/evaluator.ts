import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "../facet-registry";
import { baseParams, buildTimeWhere } from "./helpers";

/**
 * Evaluator facet: distinct `EvaluatorId`s labelled by the evaluator's
 * display name (falling back to the id when no name is recorded). The
 * evaluator type is intentionally omitted from the label — in practice a
 * project's evaluators are mostly the same type, so the prefix added
 * noise and ate the horizontal room the name needs. The id still
 * round-trips through `facet_value` for saved queries.
 */
export function buildEvaluatorFacetQuery(ctx: FacetQueryContext): FacetQuery {
  const where = buildTimeWhere("ScheduledAt");
  const prefixFilter = ctx.prefix
    ? "AND lower(ifNull(EvaluatorName, '')) ILIKE concat({prefix:String}, '%')"
    : "";

  return {
    sql: `
      SELECT
        EvaluatorId AS facet_value,
        if(ifNull(EvaluatorName, '') != '', EvaluatorName, EvaluatorId) AS facet_label,
        count() AS cnt,
        count() OVER () AS total_distinct
      FROM evaluation_runs
      WHERE ${where}
        AND ifNull(EvaluatorId, '') != ''
        ${prefixFilter}
      GROUP BY EvaluatorId, EvaluatorName
      ORDER BY cnt DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    params: {
      ...baseParams(ctx),
      ...(ctx.prefix ? { prefix: ctx.prefix } : {}),
    },
  };
}

export const EVALUATOR_FACET: QueryBuilderCategoricalDef = {
  key: "evaluator",
  kind: "categorical",
  label: "Evaluator",
  group: "evaluation",
  table: "evaluation_runs",
  queryBuilder: buildEvaluatorFacetQuery,
};
