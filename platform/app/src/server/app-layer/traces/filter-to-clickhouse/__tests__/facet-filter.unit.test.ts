/**
 * @vitest-environment node
 *
 * The per-facet compile behind the sidebar counts: a facet is counted under
 * the active query with its own field left out, so it keeps listing its other
 * values (specs/traces-v2/search.feature, "Facet count updates").
 */
import { describe, expect, it } from "vitest";
import {
  createFacetFilterCompiler,
  queryNamesFacet,
  queryWithoutFacet,
} from "../facet-filter";
import { translateFilterToClickHouse } from "../index";

const TENANT = "project-1";
const WINDOW = { from: 1_700_000_000_000, to: 1_700_086_400_000 };

describe("queryWithoutFacet", () => {
  describe("when the query names the facet's field", () => {
    /** @scenario "Facet counts show how many results another filter would yield" */
    it("drops that field's terms and keeps the rest", () => {
      expect(
        queryWithoutFacet({
          queryText: "status:error AND model:gpt-4o",
          facetKey: "status",
        }),
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
        queryWithoutFacet({
          queryText: "status:error OR status:ok",
          facetKey: "status",
        }),
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
    expect(
      queryNamesFacet({ queryText: "status:error", facetKey: "status" }),
    ).toBe(true);
    expect(
      queryNamesFacet({
        queryText: "evaluator.verdict:pass",
        facetKey: "evaluator",
      }),
    ).toBe(true);
    expect(
      queryNamesFacet({ queryText: "model:gpt-4o refund", facetKey: "status" }),
    ).toBe(false);
    expect(queryNamesFacet({ queryText: "", facetKey: "status" })).toBe(false);
  });
});

describe("createFacetFilterCompiler", () => {
  describe("given a query naming two fields", () => {
    const compiler = createFacetFilterCompiler({
      queryText: "status:error AND service:api",
      tenantId: TENANT,
      timeRange: WINDOW,
    });
    const serviceOnly = translateFilterToClickHouse(
      "service:api",
      TENANT,
      WINDOW,
    )!;
    const statusOnly = translateFilterToClickHouse(
      "status:error",
      TENANT,
      WINDOW,
    )!;

    /** @scenario "Facet counts show how many results another filter would yield" */
    it("compiles each named facet without its own field", () => {
      expect(compiler.forFacet("status")?.sql).toBe(serviceOnly.sql);
      expect(compiler.forFacet("service")?.sql).toBe(statusOnly.sql);
    });

    /** @scenario "Facet counts update when a filter is applied" */
    it("compiles the whole query for a facet the query never names", () => {
      const whole = translateFilterToClickHouse(
        "status:error AND service:api",
        TENANT,
        WINDOW,
      )!;
      expect(compiler.forFacet("model")?.sql).toBe(whole.sql);
    });

    /** @scenario "Facet counts are fetched in a single batched query" */
    it("answers one object for every facet that shares a predicate", () => {
      expect(compiler.forFacet("model")).toBe(compiler.forFacet("user"));
      expect(compiler.forFacet("status")).toBe(compiler.forFacet("status"));
      expect(compiler.forFacet("status")).not.toBe(compiler.forFacet("model"));
    });
  });

  describe("given a query that only names one facet", () => {
    it("answers no predicate for that facet and the query for the others", () => {
      const compiler = createFacetFilterCompiler({
        queryText: "status:error",
        tenantId: TENANT,
        timeRange: WINDOW,
      });
      expect(compiler.forFacet("status")).toBeUndefined();
      expect(compiler.forFacet("model")).toBeDefined();
    });
  });

  describe("given an empty query", () => {
    it("answers no predicate for every facet", () => {
      const compiler = createFacetFilterCompiler({
        queryText: "",
        tenantId: TENANT,
        timeRange: WINDOW,
      });
      expect(compiler.forFacet("status")).toBeUndefined();
    });
  });
});
