import { describe, expect, it } from "vitest";
import { type EventSpanRow, mapEventAttrsToEvent } from "../event-attrs.mapper";

function row(attrs: Record<string, string>): EventSpanRow {
  return {
    TraceId: "trace-1",
    SpanId: "span-1",
    StartTimeMs: 1000,
    EndTimeMs: 1500,
    EventAttrs: attrs,
  };
}

describe("mapEventAttrsToEvent", () => {
  describe("when the span carries an event.type with metrics and details", () => {
    it("maps it into a typed Event, splitting metrics from details", () => {
      const event = mapEventAttrsToEvent({
        row: row({
          "event.type": "thumbs_up_down",
          "event.metrics.vote": "1",
          "event.details.reason": "great answer",
        }),
        projectId: "project-1",
      });

      expect(event).toEqual({
        event_id: "span-1",
        event_type: "thumbs_up_down",
        project_id: "project-1",
        metrics: { vote: 1 },
        event_details: { reason: "great answer" },
        trace_id: "trace-1",
        timestamps: { started_at: 1000, inserted_at: 1000, updated_at: 1500 },
      });
    });
  });

  describe("when a metric value is not numeric", () => {
    it("drops the non-finite metric rather than emitting NaN", () => {
      const event = mapEventAttrsToEvent({
        row: row({
          "event.type": "custom",
          "event.metrics.bad": "not-a-number",
        }),
        projectId: "project-1",
      });

      expect(event?.metrics).toEqual({});
    });
  });

  describe("when the span has no event.type", () => {
    it("returns null so it is not counted as an event", () => {
      expect(
        mapEventAttrsToEvent({
          row: row({ "event.metrics.vote": "1" }),
          projectId: "project-1",
        }),
      ).toBeNull();
    });
  });
});
