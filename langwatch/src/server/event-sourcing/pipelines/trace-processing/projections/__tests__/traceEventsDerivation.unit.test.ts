import { describe, expect, it } from "vitest";
import { deriveTraceEventsFromSpans } from "../services/trace-events.derivation";
import { createTestSpan } from "./fixtures/trace-summary-test.fixtures";

/**
 * The trace-level events list is derived from the complete span set at read
 * time instead of being hoisted onto the fold state per span (which grew the
 * fold O(span-count)). These tests pin the shaping: one entry per span event,
 * string-coerced attribute values, all events incl. exceptions, matching what
 * the old fold accumulation produced.
 */
describe("deriveTraceEventsFromSpans", () => {
  describe("given no spans", () => {
    it("returns an empty list", () => {
      expect(deriveTraceEventsFromSpans([])).toEqual([]);
    });
  });

  describe("given spans without events", () => {
    it("returns an empty list", () => {
      const spans = [
        createTestSpan({ spanId: "a", events: [] }),
        createTestSpan({ spanId: "b", events: [] }),
      ];
      expect(deriveTraceEventsFromSpans(spans)).toEqual([]);
    });
  });

  describe("given spans carrying events", () => {
    it("hoists every event with its span id, name, timestamp and attributes", () => {
      const spans = [
        createTestSpan({
          spanId: "span-1",
          events: [
            { name: "thumbs_up_down", timeUnixMs: 1700, attributes: { value: "up" } },
            { name: "exception", timeUnixMs: 1800, attributes: { "exception.type": "Boom" } },
          ],
        }),
        createTestSpan({
          spanId: "span-2",
          events: [
            { name: "checkpoint", timeUnixMs: 1900, attributes: { step: "2" } },
          ],
        }),
      ];

      const events = deriveTraceEventsFromSpans(spans);

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({
        spanId: "span-1",
        timestamp: 1700,
        name: "thumbs_up_down",
        attributes: { value: "up" },
      });
      // Exceptions are included, same as the old fold accumulation.
      expect(events[1]).toMatchObject({ spanId: "span-1", name: "exception" });
      expect(events[2]).toMatchObject({ spanId: "span-2", name: "checkpoint" });
    });

    it("recovers a synthetic track_event span's payload (fold no longer hoists it)", () => {
      const span = createTestSpan({
        name: "langwatch.track_event",
        spanId: "evt-span-1",
        events: [
          { name: "thumbs_up_down", timeUnixMs: 1700, attributes: { value: "up" } },
        ],
      });

      const events = deriveTraceEventsFromSpans([span]);

      expect(events).toEqual([
        {
          spanId: "evt-span-1",
          timestamp: 1700,
          name: "thumbs_up_down",
          attributes: { value: "up" },
        },
      ]);
    });

    it("string-coerces attribute values and drops null/undefined", () => {
      const span = createTestSpan({
        spanId: "span-1",
        events: [
          {
            name: "metrics",
            timeUnixMs: 1700,
            attributes: {
              count: 5,
              ratio: 0.5,
              ok: true,
              missing: null as unknown as string,
            },
          },
        ],
      });

      const [event] = deriveTraceEventsFromSpans([span]);

      expect(event?.attributes).toEqual({ count: "5", ratio: "0.5", ok: "true" });
      expect(event?.attributes).not.toHaveProperty("missing");
    });
  });
});
