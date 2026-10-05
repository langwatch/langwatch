/**
 * `has:feedback` has to find the feedback LangWatch actually records: a
 * `thumbs_up_down` tracked event, sent to `POST /api/events/track` or rebuilt
 * from an SDK `langwatch.event` span event, lands on the trace under that name.
 */
import type { DerivedTraceEvent, InMemoryTrace, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { traceMatchesQuery } from "../trace-query-evaluation.rules.ts";
import { translateFilter } from "../trace-query.rules.ts";

function traceWithEvents(names: string[]): InMemoryTrace {
  const events: DerivedTraceEvent[] = names.map((name) => ({
    spanId: "s1",
    timestamp: 0,
    name,
    attributes: {},
  }));
  const summary: Pick<TraceSummaryData, "annotationIds"> = { annotationIds: [] };
  return { summary: summary as TraceSummaryData, events };
}

describe("has:feedback", () => {
  describe("when the trace carries a thumbs_up_down event", () => {
    /** @scenario "`@has:feedback` shorthand" */
    it("matches in memory", () => {
      expect(traceMatchesQuery("has:feedback", traceWithEvents(["thumbs_up_down"]))).toBe(true);
    });

    it("is not matched by none:feedback", () => {
      expect(traceMatchesQuery("none:feedback", traceWithEvents(["thumbs_up_down"]))).toBe(false);
    });
  });

  describe("when the trace carries only other events", () => {
    it("does not match", () => {
      expect(traceMatchesQuery("has:feedback", traceWithEvents(["page_view"]))).toBe(false);
    });
  });

  describe("when compiled to ClickHouse", () => {
    it("looks for the thumbs_up_down event name", () => {
      const compiled = translateFilter({
        queryText: "has:feedback",
        tenantId: "t1",
        timeRange: { from: 0, to: 1 },
      });
      expect(compiled?.sql).toContain("thumbs_up_down");
    });
  });
});
