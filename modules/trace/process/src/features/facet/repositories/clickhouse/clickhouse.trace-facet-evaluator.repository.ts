import { clickhouseRead, cond, fn, param } from "@langwatch/clickhouse-client/builder";

import { evaluationRuns as runs } from "../../../../repositories/clickhouse/clickhouse.evaluation-runs.table.ts";
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

/**
 * Cap on distinct label values surfaced per evaluator in drilldown.
 */
const LABEL_VALUES_TOP_N = 10;

class ClickHouseTraceFacetEvaluatorRepository {
  private constructor(private readonly facetQueries: ClickHouseTraceFacetQueryRepository) {}

  static create(): ClickHouseTraceFacetEvaluatorRepository {
    return new ClickHouseTraceFacetEvaluatorRepository(
      ClickHouseTraceFacetQueryRepository.create(),
    );
  }

  /**
   * Discovers evaluators with label display and aggregated pass/fail/score stats. The label
   * buckets' sumMap runs once per group, in the inner read; the outer read only reshapes it.
   */
  buildEvaluatorFacetQuery(ctx: FacetQueryContext): FacetQuery {
    const scope = facetScopeOf(ctx);
    const name = fn.ifNull(runs.EvaluatorName, "");
    const evaluators = facetRows({ source: FACET_SOURCES.evaluation_runs, scan: ctx, scope })
      .where(
        () =>
          cond.and(
            cond.ne(fn.ifNull(runs.EvaluatorId, ""), ""),
            this.facetQueries.prefixed(name, ctx.prefix),
          ),
        { inElection: false },
      )
      .select({
        facet_value: runs.EvaluatorId,
        facet_label: fn.if(cond.ne(name, ""), runs.EvaluatorName, runs.EvaluatorId),
        cnt: fn.count(),
        passed_count: fn.countIf(cond.eq(runs.Passed, 1)),
        failed_count: fn.countIf(cond.eq(runs.Passed, 0)),
        errored_count: fn.countIf(cond.eq(runs.Status, "error")),
        score_min: fn.minIf(runs.Score, cond.isNotNull(runs.Score)),
        score_max: fn.maxIf(runs.Score, cond.isNotNull(runs.Score)),
        has_score: cond.gt(fn.countIf(cond.isNotNull(runs.Score)), 0),
        // 0..2 exactly, 3 for more: the drilldown only asks whether a score is binary.
        distinct_scores: fn.uniqUpTo(2, runs.Score),
        has_label: cond.gt(
          fn.countIf(cond.and(cond.isNotNull(runs.Label), cond.ne(runs.Label, ""))),
          0,
        ),
        label_buckets: fn.sumMap(fn.array(fn.ifNull(runs.Label, "")), fn.array(param.uint64(1))),
      })
      .groupBy(runs.EvaluatorId, runs.EvaluatorName)
      .as("evaluators");
    return clickhouseRead({ scope })
      .from(evaluators)
      .select({
        facet_value: evaluators.facet_value,
        facet_label: evaluators.facet_label,
        cnt: evaluators.cnt,
        passed_count: evaluators.passed_count,
        failed_count: evaluators.failed_count,
        errored_count: evaluators.errored_count,
        score_min: evaluators.score_min,
        score_max: evaluators.score_max,
        has_score: evaluators.has_score,
        distinct_scores: evaluators.distinct_scores,
        has_label: evaluators.has_label,
        // The top emitted labels by count, the empty bucket dropped, for the drilldown's rows.
        label_values: fn.arraySlice(
          fn.arrayReverseSortBy(
            (bucket) => fn.tupleElement(bucket, "1"),
            fn.arrayFilter(
              (bucket) => cond.ne(fn.toString(fn.tupleElement(bucket, "0")), ""),
              fn.arrayZip(
                fn.tupleElement(evaluators.label_buckets, "0"),
                fn.tupleElement(evaluators.label_buckets, "1"),
              ),
            ),
          ),
          1,
          LABEL_VALUES_TOP_N,
        ),
        total_distinct: fn.over(fn.count(), {}),
      })
      .orderBy("cnt", "DESC")
      .limit(ctx.limit)
      .offset(ctx.offset)
      .settings(FACET_SETTINGS)
      .build();
  }
}

const evaluatorFacetRepository = ClickHouseTraceFacetEvaluatorRepository.create();

export const EVALUATOR_FACET: QueryBuilderCategoricalDef = {
  key: "evaluator",
  kind: "categorical",
  label: "Evaluator",
  group: "evaluation",
  table: "evaluation_runs",
  queryBuilder: (ctx) => evaluatorFacetRepository.buildEvaluatorFacetQuery(ctx),
};
