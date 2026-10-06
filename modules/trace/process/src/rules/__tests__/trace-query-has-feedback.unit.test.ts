/**
 * `has:feedback` finds the `thumbs_up_down` event, which is how both
 * `POST /api/events/track` and an SDK `langwatch.event` span event land.
 */
import type { InMemoryTrace, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { traceMatchesQuery } from "../trace-query-evaluation.rules.ts";
import { translateFilter } from "../trace-query.rules.ts";

function traceWithEvents(names: string[]): InMemoryTrace {
  const summary: Pick<TraceSummaryData, "traceId" | "annotationIds"> = {
    traceId: "trace-1",
    annotationIds: [],
  };
  return {
    summary: summary as TraceSummaryData,
    events: names.map((name) => ({ spanId: "s1", timestamp: 0, name, attributes: {} })),
  };
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
