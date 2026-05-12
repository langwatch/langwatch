import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "../facet-registry";
import { baseParams, buildTimeWhere } from "./helpers";

/**
 * Evaluator facet: distinct `EvaluatorId`s with a human label that
 * combines the evaluator type and its display name. We project the
 * type/name composite as `facet_label` so the sidebar can show
 * `[llm_judge] Toxicity` while the underlying value (the id) round-trips
 * through saved queries unchanged.
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
        if(ifNull(EvaluatorName, '') != '',
           concat('[', EvaluatorType, '] ', EvaluatorName),
           concat('[', EvaluatorType, '] ', EvaluatorId)
        ) AS facet_label,
        count() AS cnt,
        count() OVER () AS total_distinct
      FROM evaluation_runs
      WHERE ${where}
        AND ifNull(EvaluatorId, '') != ''
        ${prefixFilter}
      GROUP BY EvaluatorId, EvaluatorType, EvaluatorName
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
