/**
 * The Explorer's default exclusion of Langy's own turns, and how it folds into
 * a compiled filter.
 * @see specs/traces-v2/origin-badge-filter.feature
 */

import { explorerHiddenOrigins, LANGY_TRACE_ORIGIN } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { ClickHouseTraceQueryRepository } from "../../repositories/clickhouse/clickhouse.trace-query.repository.ts";
import {
  andFilterConditions,
  findHiddenOriginConditions,
  HIDDEN_ORIGINS_PARAM,
} from "../trace-filter-hidden-origins.rules.ts";

const timeRange = { from: 1_700_000_000_000, to: 1_700_086_400_000 };

describe("explorerHiddenOrigins", () => {
  describe("given a query with no origin term", () => {
    /** @scenario "The list leaves out Langy's turns by default" */
    it.each(["", "   ", "checkout", "status:error AND model:gpt-4o"])(
      "hides Langy's origin for %j",
      (query) => {
        expect(explorerHiddenOrigins(query)).toEqual([LANGY_TRACE_ORIGIN]);
      },
    );

    it("hides it when the query is absent", () => {
      expect(explorerHiddenOrigins(null)).toEqual([LANGY_TRACE_ORIGIN]);
      expect(explorerHiddenOrigins(undefined)).toEqual([LANGY_TRACE_ORIGIN]);
    });
  });

  describe("given a query that names the origin field", () => {
    /** @scenario "Naming an origin turns the default off" */
    it.each([
      "origin:langy",
      "origin:application",
      "NOT origin:langy",
      "-origin:sample",
      "(origin:sample OR origin:application)",
      "status:error AND (origin:langy OR model:gpt-4o)",
    ])("hides nothing for %j", (query) => {
      expect(explorerHiddenOrigins(query)).toEqual([]);
    });

    it("does not mistake a free-text word or an attribute for the field", () => {
      expect(explorerHiddenOrigins("origin")).toEqual([LANGY_TRACE_ORIGIN]);
      expect(explorerHiddenOrigins('"origin:langy"')).toEqual([LANGY_TRACE_ORIGIN]);
      expect(explorerHiddenOrigins("trace.attribute.origin:langy")).toEqual([LANGY_TRACE_ORIGIN]);
    });
  });

  describe("given a query the parser rejects", () => {
    it("keeps the default, the translator reports the syntax", () => {
      expect(explorerHiddenOrigins("status:(")).toEqual([LANGY_TRACE_ORIGIN]);
    });
  });
});

describe("findHiddenOriginConditions", () => {
  describe("given nothing to hide", () => {
    it("adds no condition, and a filter alone is left as it is", () => {
      expect(findHiddenOriginConditions({ hiddenOrigins: [] })).toEqual([]);
      const filterWhere = { sql: "1 = 1", params: { a: 1 } };
      expect(andFilterConditions([filterWhere])).toBe(filterWhere);
      expect(andFilterConditions([])).toEqual({ sql: "1 = 1", params: {} });
    });
  });

  describe("given origins to hide and no filter", () => {
    /** @scenario "The list leaves out Langy's turns by default" */
    it("is the exclusion alone, reading the origin with its default", () => {
      const where = andFilterConditions(
        findHiddenOriginConditions({ hiddenOrigins: [LANGY_TRACE_ORIGIN] }),
      );

      expect(where.sql).toBe(
        `if(Attributes['langwatch.origin'] = '', 'application', Attributes['langwatch.origin']) NOT IN ({${HIDDEN_ORIGINS_PARAM}:Array(String)})`,
      );
      expect(where.params).toEqual({ [HIDDEN_ORIGINS_PARAM]: [LANGY_TRACE_ORIGIN] });
    });
  });

  describe("given origins to hide and a compiled filter", () => {
    /** @scenario "The list leaves out Langy's turns by default" */
    it("keeps the filter whole and ANDs the exclusion after it", () => {
      const compiled = ClickHouseTraceQueryRepository.create().translateFilter({
        queryText: "status:error OR model:gpt-4o",
        tenantId: "project_test",
        timeRange,
      });
      expect(compiled).not.toBeNull();

      const where = andFilterConditions([
        ...(compiled ? [compiled] : []),
        ...findHiddenOriginConditions({ hiddenOrigins: [LANGY_TRACE_ORIGIN] }),
      ]);

      expect(where.sql.startsWith(`(${compiled?.sql}) AND `)).toBe(true);
      expect(where.sql).toContain(`NOT IN ({${HIDDEN_ORIGINS_PARAM}:Array(String)})`);
      expect(where.params).toEqual({
        ...compiled?.params,
        [HIDDEN_ORIGINS_PARAM]: [LANGY_TRACE_ORIGIN],
      });
    });

    it("does not let the filter's params carry the hidden list", () => {
      const hiddenOrigins = [LANGY_TRACE_ORIGIN];
      const [condition] = findHiddenOriginConditions({ hiddenOrigins });

      expect(condition?.params[HIDDEN_ORIGINS_PARAM]).not.toBe(hiddenOrigins);
    });
  });
});
