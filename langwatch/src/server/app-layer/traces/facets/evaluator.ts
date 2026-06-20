import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "../facet-registry";
import { baseParams, buildTimeWhere } from "./helpers";

/**
 * Cap on the distinct emitted-label values surfaced per evaluator. The
 * drilldown renders these as clickable filter rows; beyond ~10 the list stops
 * being a quick picker and starts bloating the discover payload, so we keep
 * only the most frequent values (ties broken by ClickHouse's sort).
 */
const LABEL_VALUES_TOP_N = 10;

/**
 * Evaluator facet: distinct `EvaluatorId`s labelled by the evaluator's
 * display name (falling back to the id when no name is recorded). The
 * evaluator type is intentionally omitted from the label — in practice a
 * project's evaluators are mostly the same type, so the prefix added
 * noise and ate the horizontal room the name needs. The id still
 * round-trips through `facet_value` for saved queries.
 *
 * Each row also carries the result aggregates the sidebar drilldown
 * renders inline: per-evaluator pass/fail counts, score min/max, and
 * a hasLabel/hasScore discriminator the UI uses to choose which
 * result picker to show (verdict pills, score slider, label list).
 * Computed in the same query so the sidebar doesn't pay a separate
 * round-trip per evaluator.
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
        countIf(Passed = 1) AS passed_count,
        countIf(Passed = 0) AS failed_count,
        countIf(Status = 'error') AS errored_count,
        minIf(Score, isNotNull(Score)) AS score_min,
        maxIf(Score, isNotNull(Score)) AS score_max,
        countIf(isNotNull(Score)) > 0 AS has_score,
        -- Distinct non-null score values, capped at 3 (uniqUpTo(2) returns
        -- 0..2 exactly and 3 for "more than 2"). The drilldown only branches
        -- on distinct_scores == 2 to suppress a pointless score slider when
        -- the score is a binary 0/1 that just mirrors the pass/fail verdict,
        -- so counting beyond 3 distinct values wastes CPU/memory on
        -- evaluators with many distinct scores.
        uniqUpTo(2)(IF(isNotNull(Score), Score, NULL)) AS distinct_scores,
        countIf(isNotNull(Label) AND Label != '') > 0 AS has_label,
        -- Top-N distinct emitted-label values + counts for the drilldown's
        -- clickable label-filter rows. sumMap aggregates Label → count in one
        -- pass; arrayFilter drops the empty/null bucket, arrayReverseSort ranks
        -- by count desc, arraySlice caps the list so a label-happy evaluator
        -- can't balloon the discover payload. The (value, count) tuples
        -- serialise as [[value, count], …] JSON arrays the mapper reshapes.
        arraySlice(
          arrayReverseSort(
            x -> x.2,
            arrayFilter(
              x -> x.1 != '',
              arrayZip(
                sumMap([ifNull(Label, '')], [toUInt64(1)]).1,
                sumMap([ifNull(Label, '')], [toUInt64(1)]).2
              )
            )
          ),
          1, ${LABEL_VALUES_TOP_N}
        ) AS label_values,
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
