import { describe, expect, it } from "vitest";
import type { FacetQueryContext } from "../../facet-registry";
import { buildEvaluatorFacetQuery } from "../evaluator";

function ctx(overrides: Partial<FacetQueryContext> = {}): FacetQueryContext {
  return {
    tenantId: "project_test",
    timeRange: { from: 0, to: 1 },
    limit: 25,
    offset: 0,
    ...overrides,
  };
}

describe("buildEvaluatorFacetQuery", () => {
  describe("given an evaluator facet request", () => {
    describe("when the label projection is built", () => {
      /** @scenario Evaluator facet labels drop the type prefix */
      it("labels rows by name (or id) without the evaluator-type prefix", () => {
        const { sql } = buildEvaluatorFacetQuery(ctx());
        // The label is name-or-id only: a bracketed `[type]` prefix repeats
        // across rows and eats the room the name needs to disambiguate.
        expect(sql).not.toMatch(/concat\('\[',\s*EvaluatorType/);
        expect(sql).toMatch(
          /if\(ifNull\(EvaluatorName, ''\) != '', EvaluatorName, EvaluatorId\) AS facet_label/,
        );
      });

      it("still keys the facet value off the evaluator id for query round-trips", () => {
        const { sql } = buildEvaluatorFacetQuery(ctx());
        expect(sql).toMatch(/EvaluatorId AS facet_value/);
      });
    });

    describe("when the result aggregates are built", () => {
      /** @scenario Binary 0/1 score hides the score slider */
      it("counts distinct non-null scores capped at 3 so the drilldown can suppress a binary score slider", () => {
        const { sql } = buildEvaluatorFacetQuery(ctx());
        expect(sql).toMatch(
          /uniqUpTo\(2\)\(IF\(isNotNull\(Score\), Score, NULL\)\) AS distinct_scores/,
        );
      });

      /** @scenario Evaluator label values are filterable */
      it("aggregates top emitted-label values + counts as label_values", () => {
        const { sql } = buildEvaluatorFacetQuery(ctx());
        // sumMap tallies Label -> count in one pass; the empty bucket is
        // filtered, ranked by count desc, and capped (top-10) so the discover
        // payload can't balloon for a label-happy evaluator.
        expect(sql).toMatch(
          /sumMap\(\[ifNull\(Label, ''\)\], \[toUInt64\(1\)\]\)/,
        );
        expect(sql).toMatch(/arrayFilter\(\s*x -> x\.1 != ''/);
        expect(sql).toMatch(/arrayReverseSort\(/);
        expect(sql).toMatch(/AS label_values/);
        // Cap is present so the array stays bounded.
        expect(sql).toMatch(/1,\s*10\s*\)\s*AS label_values/);
      });
    });
  });
});
