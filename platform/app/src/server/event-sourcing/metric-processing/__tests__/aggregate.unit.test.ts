import { describe, expect, it } from "vitest";
import { metric, metricAggregateId } from "../aggregate";
import { point } from "./fixtures";

describe("the metric aggregate (ADR-105)", () => {
  it("derives the event type string from the aggregate name and event key", () => {
    expect(metric.eventTypes).toEqual(["metric/dataPointReceived"]);
  });

  it("names pointId as the aggregate id, since a point is its own aggregate", () => {
    const canonical = point({ timeUnixMs: 1_000 });
    expect(metricAggregateId(canonical)).toBe(canonical.pointId);
  });

  describe("the recordDataPoint command", () => {
    it("emits exactly one dataPointReceived event carrying the input unchanged", () => {
      const canonical = point({ timeUnixMs: 1_000, valueDouble: 0 });
      const events = metric.commands.recordDataPoint.handle(
        metric.init(),
        canonical,
        metric.events,
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("metric/dataPointReceived");
      expect(events[0]!.data).toEqual(canonical);
      // The zero value in the input survives untouched into the emitted event.
      expect(events[0]!.data.valueDouble).toBe(0);
    });
  });

  describe("apply", () => {
    it("is total over an unrecognised event type — returns state unchanged", () => {
      const state = metric.init();
      const next = metric.apply(state, {
        type: "metric/somethingUnknown",
        data: {},
      });
      expect(next).toEqual(state);
    });

    it("records the received point's id from a real event", () => {
      const canonical = point({ timeUnixMs: 1_000 });
      const next = metric.apply(
        metric.init(),
        metric.events.dataPointReceived(canonical),
      );
      expect(next).toEqual({
        pointId: canonical.pointId,
        receivedAt: canonical.acceptedAt,
      });
    });
  });
});
