/**
 * The Explorer's default exclusion of Langy's own turns; the built exclusion is
 * `findHiddenOriginFilters` (clickhouse.trace-filter-condition.mapper.ts).
 * @see specs/traces-v2/origin-badge-filter.feature
 */

import { explorerHiddenOrigins, LANGY_TRACE_ORIGIN } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

describe("explorerHiddenOrigins", () => {
  describe("given a query with no origin term", () => {
    /** @scenario "The list leaves out Langy's turns by default" */
    it.each(["", "   ", "checkout", "status:error AND model:gpt-5-mini"])(
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
      "status:error AND (origin:langy OR model:gpt-5-mini)",
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

  describe("given the person's own personal project", () => {
    /** @scenario "A personal project shows Langy's turns" */
    it.each(["", "checkout", "status:error"])("hides nothing for %j", (query) => {
      expect(explorerHiddenOrigins(query, { personalProject: true })).toEqual([]);
    });
  });

  describe("given a project that is not personal", () => {
    it("keeps Langy's turns out", () => {
      expect(explorerHiddenOrigins("", { personalProject: false })).toEqual([LANGY_TRACE_ORIGIN]);
    });
  });
});
