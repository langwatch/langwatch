/**
 * `has:feedback` has to find the feedback LangWatch actually records. User
 * feedback arrives as a `thumbs_up_down` tracked event — over
 * `POST /api/events/track`, or reconstructed from an SDK `langwatch.event` span
 * event — and both land as an event named `thumbs_up_down` on the trace.
 */
import { describe, expect, it } from "vitest";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import type { TraceSummaryData } from "../../types";
import { translateFilterToClickHouse } from "../ast";
import { evaluateQueryInMemory } from "../evaluate";
import type { InMemoryTrace } from "../field-def";

function traceWithEvents(names: string[]): InMemoryTrace {
  const events: DerivedTraceEvent[] = names.map((name) => ({
    spanId: "s1",
    timestamp: 0,
    name,
    attributes: {},
  }));
  return {
    summary: { annotationIds: [] } as unknown as TraceSummaryData,
    events,
  };
}

describe("has:feedback", () => {
  describe("when the trace carries a thumbs_up_down event", () => {
    /** @scenario "`@has:feedback` shorthand" */
    it("matches in memory", () => {
      expect(
        evaluateQueryInMemory(
          "has:feedback",
          traceWithEvents(["thumbs_up_down"]),
        ),
      ).toBe(true);
    });

    it("is not matched by none:feedback", () => {
      expect(
        evaluateQueryInMemory(
          "none:feedback",
          traceWithEvents(["thumbs_up_down"]),
        ),
      ).toBe(false);
    });
  });

  describe("when the trace carries only other events", () => {
    it("does not match", () => {
      expect(
        evaluateQueryInMemory("has:feedback", traceWithEvents(["page_view"])),
      ).toBe(false);
    });
  });

  describe("when compiled to ClickHouse", () => {
    it("looks for the thumbs_up_down event name", () => {
      const compiled = translateFilterToClickHouse("has:feedback", "t1", {
        from: 0,
        to: 1,
      });
      expect(compiled?.sql).toContain("thumbs_up_down");
    });
  });
});
