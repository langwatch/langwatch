import { describe, expect, it } from "vitest";
import { NO_TRACE_EVENTS } from "../../types/trace";
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
        events: NO_TRACE_EVENTS,
      });
    });
  });

  describe("when two rows hold the same trace id under different projects", () => {
    it("keeps each row's own evaluations", () => {
      const toxicity = {
        evaluatorId: "e1",
        evaluatorName: "Toxicity",
        status: "processed",
        score: 0.9,
        passed: true,
        label: "safe",
      };
      const rows = mapTraceListPayload({
        items: [
          { traceId: "t1", projectId: "member-a", evaluations: [toxicity] },
          { traceId: "t1", projectId: "member-b", evaluations: [] },
        ],
      });
      expect(rows[0]?.evaluations).toEqual([toxicity]);
      // The second row has none of its own, so it gets an empty list.
      expect(rows[1]?.evaluations).toEqual([]);
      expect(rows.map((row) => row.projectId)).toEqual(["member-a", "member-b"]);
    });
  });

  describe("given items that already carry spanCount", () => {
    describe("when mapping the payload", () => {
      it("preserves the supplied value", () => {
        const rows = mapTraceListPayload({
          items: [{ traceId: "t1", spanCount: 7 }],
        });
        expect(rows[0]?.spanCount).toBe(7);
      });
    });
  });

  describe("given a list payload that carries no events", () => {
    describe("when mapping the payload", () => {
      it("leaves rows eventless for the separate events read to fill in", () => {
        // Events are not on the trace summary — `useTraceListEvents` merges
        // them in from `tracesV2.listEvents`, so the list payload never
        // carries any.
        const rows = mapTraceListPayload({ items: [{ traceId: "t1" }] });
        expect(rows[0]?.events).toEqual(NO_TRACE_EVENTS);
      });
    });
  });
});
