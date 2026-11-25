/**
 * A query's sources: the trace origins it counts, and the schema every door checks them with.
 * @see modules/dashboard/specs/dashboards-v2.feature AC200n
 */

import { describe, expect, it } from "vitest";

import { lwqlQueryRequestSchema } from "../analytics-lwql.trpc.ts";
import { TRACE_SOURCES, traceSourcesSchema } from "../analytics.lwql.ts";

describe("TRACE_SOURCES", () => {
  it("lists the known origins in pill order, then other", () => {
    expect(TRACE_SOURCES).toEqual([
      "application",
      "simulation",
      "evaluation",
      "sample",
      "coding_agent",
      "ai_tool",
      "gateway",
      "workflow",
      "playground",
      "langy",
      "other",
    ]);
  });
});

describe("traceSourcesSchema", () => {
  /** @scenario "AC200n Sources: an unknown source is refused at every door" */
  it("refuses a value outside the listed sources", () => {
    expect(traceSourcesSchema.validate(["application", "langy"])).toBe(true);
    expect(traceSourcesSchema.validate(["application", "x'); DROP TABLE t; --"])).toBe(false);
    expect(traceSourcesSchema.validate(["Langy"])).toBe(false);
  });

  /** @scenario "AC200n Sources: an unknown source is refused at every door" */
  it("is the query door's check too, so an unknown source never reaches the statement", () => {
    const run = { projectId: "p", sql: "SELECT 1" };

    expect(lwqlQueryRequestSchema.validate({ ...run, sources: ["langy"] })).toBe(true);
    expect(lwqlQueryRequestSchema.validate({ ...run, sources: null })).toBe(true);
    expect(lwqlQueryRequestSchema.validate({ ...run, sources: ["langy') OR 1"] })).toBe(false);
  });
});
