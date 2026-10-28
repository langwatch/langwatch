/**
 * A query's sources: the trace origins it counts, and the origin filter a picked set runs as.
 * @see modules/dashboard/specs/dashboards-v2.feature AC200b, AC200l, AC200m, AC200n
 */

import { describe, expect, it } from "vitest";

import { lwqlQueryRequestSchema } from "../analytics-lwql.trpc.ts";
import { TRACE_SOURCES, traceSourceScope, traceSourcesSchema } from "../trace-sources.ts";

describe("TRACE_SOURCES", () => {
  it("lists the eight known origins in pill order, then other", () => {
    expect(TRACE_SOURCES).toEqual([
      "application",
      "simulation",
      "evaluation",
      "coding_agent",
      "gateway",
      "workflow",
      "playground",
      "langy",
      "other",
    ]);
  });
});

describe("traceSourceScope", () => {
  describe("given a picked set without other", () => {
    /** @scenario "AC200b Sources: a query saved with picked sources counts only traces of those origins" */
    it("keeps only the picked origins", () => {
      expect(traceSourceScope(["application", "langy"])).toEqual({
        kind: "include",
        origins: ["application", "langy"],
      });
    });
  });

  describe("given a picked set with other", () => {
    /** @scenario "AC200l Sources: other counts every origin outside the eight known ones" */
    it("drops the known origins left unpicked, so every unlisted origin stays", () => {
      expect(traceSourceScope(["application", "other"])).toEqual({
        kind: "exclude",
        origins: [
          "simulation",
          "evaluation",
          "coding_agent",
          "gateway",
          "workflow",
          "playground",
          "langy",
        ],
      });
    });

    it("drops nothing when every source is picked", () => {
      expect(traceSourceScope([...TRACE_SOURCES])).toEqual({ kind: "every" });
    });
  });

  describe("given an empty picked set", () => {
    /** @scenario "AC200m Sources: a query with no source picked counts nothing and says so" */
    it("keeps no origin at all", () => {
      expect(traceSourceScope([])).toEqual({ kind: "include", origins: [] });
    });
  });
});

describe("traceSourcesSchema", () => {
  /** @scenario "AC200n Sources: an unknown source is refused at every door" */
  it("refuses a value outside the nine sources", () => {
    expect(traceSourcesSchema.validate(["application", "langy"])).toBe(true);
    expect(traceSourcesSchema.validate(["application", "x'); DROP TABLE t; --"])).toBe(false);
    expect(traceSourcesSchema.validate(["Langy"])).toBe(false);
  });

  /** @scenario "AC200n Sources: an unknown source is refused at every door" */
  it("is the query door's check too, so an unknown source never reaches the statement", () => {
    const run = { projectId: "p", sql: "SELECT 1" };

    expect(lwqlQueryRequestSchema.validate({ ...run, sources: ["langy"] })).toBe(true);
    expect(lwqlQueryRequestSchema.validate({ ...run, sources: ["langy') OR 1"] })).toBe(false);
  });
});
