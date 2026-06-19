import { describe, expect, it } from "vitest";
import { mapTraceListPayload } from "../mapTraceListPayload";

describe("mapTraceListPayload", () => {
  describe("when the payload is undefined", () => {
    it("returns an empty list", () => {
      expect(mapTraceListPayload(undefined)).toEqual([]);
    });
  });

  describe("when items carry no evaluations", () => {
    it("defaults spanCount and events and attaches an empty evaluations list", () => {
      const rows = mapTraceListPayload({
        items: [{ traceId: "t1", name: "trace one" }],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        traceId: "t1",
        spanCount: 0,
        evaluations: [],
        events: [],
      });
    });
  });

  describe("when the evaluations map has entries for a trace", () => {
    it("attaches that trace's evaluations by id", () => {
      const rows = mapTraceListPayload({
        items: [{ traceId: "t1" }, { traceId: "t2" }],
        evaluations: {
          t1: [
            {
              evaluatorId: "e1",
              evaluatorName: "Toxicity",
              status: "processed",
              score: 0.9,
              passed: true,
              label: "safe",
            },
          ],
        },
      });
      expect(rows[0]?.evaluations).toEqual([
        {
          evaluatorId: "e1",
          evaluatorName: "Toxicity",
          status: "processed",
          score: 0.9,
          passed: true,
          label: "safe",
        },
      ]);
      // t2 has no entry in the map, so it gets an empty list, not undefined.
      expect(rows[1]?.evaluations).toEqual([]);
    });
  });

  describe("when items already carry spanCount and events", () => {
    it("preserves the supplied values", () => {
      const rows = mapTraceListPayload({
        items: [
          {
            traceId: "t1",
            spanCount: 7,
            events: [
              { spanId: "s1", name: "evt", timestamp: 1, attributes: {} },
            ],
          },
        ],
      });
      expect(rows[0]?.spanCount).toBe(7);
      expect(rows[0]?.events).toHaveLength(1);
    });
  });
});
