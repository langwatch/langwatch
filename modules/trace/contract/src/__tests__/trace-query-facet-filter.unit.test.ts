/**
 * The per-facet query behind the sidebar counts: a facet is counted under the
 * active query with its own field left out, so it keeps listing its other
 * values.
 * @see specs/traces-v2/search.feature
 */

import { describe, expect, it } from "vitest";

import { queryNamesFacet, queryWithoutFacet } from "../trace-query-analysis.ts";

describe("queryWithoutFacet", () => {
  describe("when the query names the facet's field", () => {
    /** @scenario "The facet's own terms are dropped and the rest kept" */
    it("drops that field's terms and keeps the rest", () => {
      expect(
        queryWithoutFacet({ queryText: "status:error AND model:gpt-4o", facetKey: "status" }),
      ).toBe("model:gpt-4o");
    });

    it("drops the field's dotted sub-fields with it", () => {
      expect(
        queryWithoutFacet({
          queryText: "(evaluator:ev1 AND evaluator.verdict:pass) AND user:u1",
          facetKey: "evaluator",
        }),
      ).toBe("user:u1");
    });

    it("keeps a field that merely shares the prefix", () => {
      expect(
        queryWithoutFacet({
          queryText: "spanName:llm AND span.attribute.x:1",
          facetKey: "span",
        }),
      ).toBe("spanName:llm");
    });

    /** @scenario "A facet term under a NOT is removed with the rest" */
    it("removes the term from under a NOT instead of keeping the group whole", () => {
      const without = queryWithoutFacet({
        queryText: "NOT (status:error OR service:api)",
        facetKey: "status",
      });
      expect(without).not.toContain("status:error");
      expect(without).toContain("service:api");
    });

    it("becomes empty when the query only named this facet", () => {
      expect(
        queryWithoutFacet({ queryText: "status:error OR status:ok", facetKey: "status" }),
      ).toBe("");
    });
  });

  describe("when the query does not name the facet's field", () => {
    it("keeps free text and other fields as they are", () => {
      expect(
        queryWithoutFacet({
          queryText: 'refund AND "checkout flow" AND user:u1',
          facetKey: "status",
        }),
      ).toBe('refund AND "checkout flow" AND user:u1');
    });
  });
});

describe("queryNamesFacet", () => {
  it("answers true for the field and its sub-fields, false otherwise", () => {
    expect(queryNamesFacet({ queryText: "status:error", facetKey: "status" })).toBe(true);
    expect(queryNamesFacet({ queryText: "evaluator.verdict:pass", facetKey: "evaluator" })).toBe(
      true,
    );
    expect(queryNamesFacet({ queryText: "model:gpt-4o refund", facetKey: "status" })).toBe(false);
    expect(queryNamesFacet({ queryText: "", facetKey: "status" })).toBe(false);
  });
});
