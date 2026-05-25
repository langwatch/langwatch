import { describe, expect, it } from "vitest";
import { buildEvaluatorFacetQuery } from "../evaluator";
import type { FacetQueryContext } from "../../facet-registry";

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
        // The type prefix used to read `[workflow] relevancy ...` and ate
        // the room the name needs — the label is now name-or-id only.
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
  });
});
