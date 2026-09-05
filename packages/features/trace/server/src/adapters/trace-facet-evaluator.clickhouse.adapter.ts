import { ClickHouseFacetQueryAdapter } from "./trace-facet-query.clickhouse.adapter";
import type {
  FacetQuery,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "./trace-facet-registry.clickhouse.adapter";

/**
 * Cap on distinct emitted-label values surfaced per evaluator. Drilldown renders these as clickable filter rows; beyond ~10 the list stops being a quick picker and bloats the discover payload, so only the most frequent survive (ties broken by ClickHouse's sort).
 */
const LABEL_VALUES_TOP_N = 10;

export class ClickHouseEvaluatorFacetAdapter {
  static create(): ClickHouseEvaluatorFacetAdapter {
    return new ClickHouseEvaluatorFacetAdapter();
  }

  /**
   * Evaluator facet: distinct EvaluatorIds labelled by display name (falling back to id). Type is intentionally omitted from the label — a project's evaluators are mostly one type, so the prefix just ate horizontal room the name needs; the id still round-trips via facet_value for saved queries. Each row also carries the aggregates the sidebar drilldown renders inline (pass/fail counts, score min/max, hasLabel/hasScore) computed in the same query so the sidebar avoids a per-evaluator round-trip.
   */
  static buildEvaluatorFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const where = ClickHouseFacetQueryAdapter.buildTimeWhere("ScheduledAt");
    const prefixFilter = ctx.prefix
      ? "AND lower(ifNull(EvaluatorName, '')) ILIKE concat({prefix:String}, '%')"
      : "";

    // The label-buckets sumMap is hoisted into the inner aggregation so it
    // runs once per group. The outer SELECT just reshapes the (keys, values)
    // tuple — earlier code referenced `sumMap(...).1` and `sumMap(...).2`
    // in the same SELECT, which evaluates the aggregate twice per group on
    // a label-happy evaluator. Bounded CPU waste, fixed by the subquery.
    return {
      sql: `
        SELECT
          facet_value,
          facet_label,
          cnt,
          passed_count,
          failed_count,
          errored_count,
          score_min,
          score_max,
          has_score,
          distinct_scores,
          has_label,
          -- Top-N distinct emitted-label values + counts for the drilldown's
          -- clickable label-filter rows. arrayFilter drops the empty/null
          -- bucket, arrayReverseSort ranks by count desc, arraySlice caps the
          -- list so a label-happy evaluator can't balloon the discover
          -- payload. The (value, count) tuples serialise as [[value, count],
          -- …] JSON arrays the mapper reshapes.
          arraySlice(
            arrayReverseSort(
              x -> x.2,
              arrayFilter(
                x -> x.1 != '',
                arrayZip(label_buckets.1, label_buckets.2)
              )
            ),
            1, ${LABEL_VALUES_TOP_N}
          ) AS label_values,
          count() OVER () AS total_distinct
        FROM (
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
            -- sumMap aggregates Label → count in one pass and is referenced
            -- twice in the outer SELECT (label_buckets.1 + .2). Hoisting it
            -- here computes it once per group.
            sumMap([ifNull(Label, '')], [toUInt64(1)]) AS label_buckets
          FROM evaluation_runs
          WHERE ${where}
            AND ifNull(EvaluatorId, '') != ''
            ${prefixFilter}
          GROUP BY EvaluatorId, EvaluatorName
        )
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

export const EVALUATOR_FACET: QueryBuilderCategoricalDef = {
  key: "evaluator",
  kind: "categorical",
  label: "Evaluator",
  group: "evaluation",
  table: "evaluation_runs",
  queryBuilder: ClickHouseEvaluatorFacetAdapter.buildEvaluatorFacetQuery,
};
