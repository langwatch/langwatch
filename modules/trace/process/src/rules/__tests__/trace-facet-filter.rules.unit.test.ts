/**
 * @vitest-environment node
 * Which predicate each facet is counted under: the query without the facet's
 * own terms, the hidden origins everywhere but origin, one object per predicate.
 * @see specs/traces-v2/search.feature
 */

import { describe, expect, it, vi } from "vitest";

import { createFacetFilterResolver } from "../trace-facet-filter.rules.ts";
import type { TraceFilterWhere } from "../trace-filter-hidden-origins.rules.ts";

const HIDDEN: TraceFilterWhere = {
  sql: "origin NOT IN ({hiddenOrigins:Array(String)})",
  params: { hiddenOrigins: ["langy"] },
};

function resolverOver(queryText: string, { hide = true }: { hide?: boolean } = {}) {
  const compile = vi.fn((text: string): TraceFilterWhere | undefined =>
    text.trim() === "" ? undefined : { sql: `compiled(${text})`, params: {} },
  );

  return {
    compile,
    filterFor: createFacetFilterResolver({
      queryText,
      compile,
      hide: (filter) => {
        if (!hide) return filter;
        const conditions = [...(filter ? [filter] : []), HIDDEN];

        return {
          sql: conditions.map((c) => `(${c.sql})`).join(" AND "),
          params: Object.assign({}, ...conditions.map((c) => c.params)),
        };
      },
    }),
  };
}

describe("given a query that names one facet's field", () => {
  describe("when that facet is counted", () => {
    it("compiles the query with its own terms left out", () => {
      const { filterFor, compile } = resolverOver("status:error AND model:gpt-4o");

      filterFor({ key: "status", table: "trace_summaries" });

      expect(compile).toHaveBeenCalledWith("model:gpt-4o");
    });
  });

  describe("when a facet the query never names is counted", () => {
    it("counts under the whole query, compiled once for all of them", () => {
      const { filterFor, compile } = resolverOver("status:error");

      const service = filterFor({ key: "service", table: "trace_summaries" });
      const model = filterFor({ key: "model", table: "trace_summaries" });

      expect(service).toBe(model);
      expect(compile).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given the hidden origins", () => {
  it("leaves them out of every facet but origin's own, so the pick stays offered", () => {
    const { filterFor } = resolverOver("status:error");

    expect(filterFor({ key: "origin", table: "trace_summaries" })?.sql).toBe(
      "compiled(status:error)",
    );
    expect(filterFor({ key: "service", table: "trace_summaries" })?.sql).toContain("hiddenOrigins");
  });
});

describe("given a facet on another table", () => {
  describe("when no query is active", () => {
    /** @scenario "Span and evaluation facets count the whole window while no filter is active" */
    it("counts the whole window, paying for no membership test", () => {
      const { filterFor } = resolverOver("");

      expect(filterFor({ key: "evaluator", table: "evaluation_runs" })).toBeUndefined();
    });
  });

  describe("when any query is active", () => {
    /** @scenario "A facet on spans or evaluations reads the listed traces once any filter is active" */
    it("counts through the traces the query selects, its own field left out", () => {
      const { filterFor, compile } = resolverOver("evaluator:ev1 AND status:error");

      const filter = filterFor({ key: "evaluator", table: "evaluation_runs" });

      expect(compile).toHaveBeenCalledWith("status:error");
      expect(filter?.sql).toContain("compiled(status:error)");
      expect(filter?.sql).toContain("hiddenOrigins");
    });
  });
});
