import { describe, it, expect, vi } from "vitest";
import { EventUtils } from "../event.utils";
import { EventStream } from "../../core/eventStream";
import type { Event } from "../../core/types";

describe("buildProjectionMetadata", () => {
  describe("when EventStream has events", () => {
    it("builds metadata from EventStream with events", () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "CREATE" as any,
          data: {},
        },
        {
          aggregateId: "agg-1",
          timestamp: 2000,
          type: "UPDATE" as any,
          data: {},
        },
        {
          aggregateId: "agg-1",
          timestamp: 3000,
          type: "DELETE" as any,
          data: {},
        },
      ];

      const stream = new EventStream("agg-1", events);
      const computedAt = 5000;

      const metadata = EventUtils.buildProjectionMetadata(stream, computedAt);

      expect(metadata.eventCount).toBe(3);
      expect(metadata.firstEventTimestamp).toBe(1000);
      expect(metadata.lastEventTimestamp).toBe(3000);
      expect(metadata.computedAtUnixMs).toBe(5000);
    });

    it("correctly extracts eventCount, firstEventTimestamp, lastEventTimestamp", () => {
      const events: Event<string>[] = [
        { aggregateId: "agg-1", timestamp: 500, type: "A" as any, data: {} },
        { aggregateId: "agg-1", timestamp: 1500, type: "B" as any, data: {} },
        { aggregateId: "agg-1", timestamp: 2500, type: "C" as any, data: {} },
        { aggregateId: "agg-1", timestamp: 3500, type: "D" as any, data: {} },
      ];

      const stream = new EventStream("agg-1", events);
      const metadata = EventUtils.buildProjectionMetadata(stream, 10000);

      expect(metadata.eventCount).toBe(4);
      expect(metadata.firstEventTimestamp).toBe(500);
      expect(metadata.lastEventTimestamp).toBe(3500);
    });

    it("handles single event stream", () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1234,
          type: "SINGLE" as any,
          data: {},
        },
      ];

      const stream = new EventStream("agg-1", events);
      const metadata = EventUtils.buildProjectionMetadata(stream, 5678);

      expect(metadata.eventCount).toBe(1);
      expect(metadata.firstEventTimestamp).toBe(1234);
      expect(metadata.lastEventTimestamp).toBe(1234);
      expect(metadata.computedAtUnixMs).toBe(5678);
    });

    it("handles stream with multiple events", () => {
      const events: Event<string>[] = [
        { aggregateId: "agg-1", timestamp: 100, type: "E1" as any, data: {} },
        { aggregateId: "agg-1", timestamp: 200, type: "E2" as any, data: {} },
        { aggregateId: "agg-1", timestamp: 300, type: "E3" as any, data: {} },
        { aggregateId: "agg-1", timestamp: 400, type: "E4" as any, data: {} },
        { aggregateId: "agg-1", timestamp: 500, type: "E5" as any, data: {} },
      ];

      const stream = new EventStream("agg-1", events);
      const metadata = EventUtils.buildProjectionMetadata(stream, 1000);

      expect(metadata.eventCount).toBe(5);
      expect(metadata.firstEventTimestamp).toBe(100);
      expect(metadata.lastEventTimestamp).toBe(500);
    });
  });

  describe("when EventStream is empty", () => {
    it("handles empty EventStream (null timestamps)", () => {
      const events: Event<string>[] = [];
      const stream = new EventStream("agg-1", events);
      const computedAt = 9999;

      const metadata = EventUtils.buildProjectionMetadata(stream, computedAt);

      expect(metadata.eventCount).toBe(0);
      expect(metadata.firstEventTimestamp).toBeNull();
      expect(metadata.lastEventTimestamp).toBeNull();
      expect(metadata.computedAtUnixMs).toBe(9999);
    });
  });

  describe("when computedAtUnixMs parameter is provided", () => {
    it("uses provided computedAtUnixMs parameter", () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
      ];

      const stream = new EventStream("agg-1", events);
      const customTimestamp = 1234567890;

      const metadata = EventUtils.buildProjectionMetadata(
        stream,
        customTimestamp,
      );

      expect(metadata.computedAtUnixMs).toBe(customTimestamp);
    });
  });

  describe("when computedAtUnixMs parameter is omitted", () => {
    it("uses current timestamp when computedAtUnixMs is omitted", () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
      ];

      const stream = new EventStream("agg-1", events);
      const beforeCall = Date.now();

      const metadata = EventUtils.buildProjectionMetadata(stream);

      const afterCall = Date.now();

      expect(metadata.computedAtUnixMs).toBeGreaterThanOrEqual(beforeCall);
      expect(metadata.computedAtUnixMs).toBeLessThanOrEqual(afterCall);
    });
  });

  describe("when events are unsorted", () => {
    it("uses sorted order from EventStream (timestamp ordering)", () => {
      const events: Event<string>[] = [
        { aggregateId: "agg-1", timestamp: 3000, type: "C" as any, data: {} },
        { aggregateId: "agg-1", timestamp: 1000, type: "A" as any, data: {} },
        { aggregateId: "agg-1", timestamp: 2000, type: "B" as any, data: {} },
      ];

      // EventStream with default timestamp ordering will sort them
      const stream = new EventStream("agg-1", events, {
        ordering: "timestamp",
      });
      const metadata = EventUtils.buildProjectionMetadata(stream, 5000);

      // Should use sorted order (first = 1000, last = 3000)
      expect(metadata.firstEventTimestamp).toBe(1000);
      expect(metadata.lastEventTimestamp).toBe(3000);
      expect(metadata.eventCount).toBe(3);
    });

    it("uses as-is order from EventStream when specified", () => {
      const events: Event<string>[] = [
        { aggregateId: "agg-1", timestamp: 3000, type: "C" as any, data: {} },
        { aggregateId: "agg-1", timestamp: 1000, type: "A" as any, data: {} },
        { aggregateId: "agg-1", timestamp: 2000, type: "B" as any, data: {} },
      ];

      // EventStream with as-is ordering preserves original order
      const stream = new EventStream("agg-1", events, { ordering: "as-is" });
      const metadata = EventUtils.buildProjectionMetadata(stream, 5000);

      // Should use original order (first = 3000, last = 2000)
      expect(metadata.firstEventTimestamp).toBe(3000);
      expect(metadata.lastEventTimestamp).toBe(2000);
      expect(metadata.eventCount).toBe(3);
    });
  });

  describe("edge cases", () => {
    it("handles events with same timestamp", () => {
      const events: Event<string>[] = [
        { aggregateId: "agg-1", timestamp: 1000, type: "A" as any, data: {} },
        { aggregateId: "agg-1", timestamp: 1000, type: "B" as any, data: {} },
        { aggregateId: "agg-1", timestamp: 1000, type: "C" as any, data: {} },
      ];

      const stream = new EventStream("agg-1", events);
      const metadata = EventUtils.buildProjectionMetadata(stream, 2000);

      expect(metadata.eventCount).toBe(3);
      expect(metadata.firstEventTimestamp).toBe(1000);
      expect(metadata.lastEventTimestamp).toBe(1000);
    });

    it("handles events with zero timestamp", () => {
      const events: Event<string>[] = [
        { aggregateId: "agg-1", timestamp: 0, type: "ZERO" as any, data: {} },
      ];

      const stream = new EventStream("agg-1", events);
      const metadata = EventUtils.buildProjectionMetadata(stream, 1000);

      expect(metadata.firstEventTimestamp).toBe(0);
      expect(metadata.lastEventTimestamp).toBe(0);
    });

    it("handles events with negative timestamp", () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: -1000,
          type: "NEGATIVE" as any,
          data: {},
        },
        { aggregateId: "agg-1", timestamp: 0, type: "ZERO" as any, data: {} },
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "POSITIVE" as any,
          data: {},
        },
      ];

      const stream = new EventStream("agg-1", events);
      const metadata = EventUtils.buildProjectionMetadata(stream, 2000);

      expect(metadata.firstEventTimestamp).toBe(-1000);
      expect(metadata.lastEventTimestamp).toBe(1000);
    });
  });
});
