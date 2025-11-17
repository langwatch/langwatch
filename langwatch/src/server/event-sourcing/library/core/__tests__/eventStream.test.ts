import { describe, it, expect } from "vitest";
import { EventStream } from "../eventStream";
import type { Event } from "../types";

describe("EventStream", () => {
  describe('constructor with "as-is" ordering', () => {
    describe("when events are provided", () => {
      it("preserves original order", () => {
        const events: Event[] = [
          {
            aggregateId: "1",
            timestamp: 3000,
            type: "trace.projection.recomputed",
            data: {},
          },
          {
            aggregateId: "1",
            timestamp: 1000,
            type: "span.ingestion.ingested",
            data: {},
          },
          {
            aggregateId: "1",
            timestamp: 2000,
            type: "trace.projection.reset",
            data: {},
          },
        ];

        const stream = new EventStream("1", events, { ordering: "as-is" });

        expect(stream.getEvents()[0]!.timestamp).toBe(3000);
      });
    });

    describe("when events array is empty", () => {
      it("creates empty stream", () => {
        const events: Event[] = [];

        const stream = new EventStream("1", events, { ordering: "as-is" });

        expect(stream.isEmpty()).toBe(true);
      });
    });
  });

  describe('constructor with "timestamp" ordering', () => {
    describe("when events are unsorted", () => {
      it("sorts by timestamp ascending", () => {
        const events: Event[] = [
          {
            aggregateId: "1",
            timestamp: 3000,
            type: "trace.projection.recomputed",
            data: {},
          },
          {
            aggregateId: "1",
            timestamp: 1000,
            type: "span.ingestion.ingested",
            data: {},
          },
          {
            aggregateId: "1",
            timestamp: 2000,
            type: "trace.projection.reset",
            data: {},
          },
        ];

        const stream = new EventStream("1", events, { ordering: "timestamp" });

        expect(stream.getEvents()[0]!.timestamp).toBe(1000);
      });
    });

    describe("when events are already sorted", () => {
      it("maintains sorted order", () => {
        const events: Event[] = [
          {
            aggregateId: "1",
            timestamp: 1000,
            type: "span.ingestion.ingested",
            data: {},
          },
          {
            aggregateId: "1",
            timestamp: 2000,
            type: "trace.projection.reset",
            data: {},
          },
          {
            aggregateId: "1",
            timestamp: 3000,
            type: "trace.projection.recomputed",
            data: {},
          },
        ];

        const stream = new EventStream("1", events, { ordering: "timestamp" });

        expect(stream.getEvents()[0]!.timestamp).toBe(1000);
      });
    });

    describe("when events array is empty", () => {
      it("creates empty stream", () => {
        const events: Event[] = [];

        const stream = new EventStream("1", events, { ordering: "timestamp" });

        expect(stream.isEmpty()).toBe(true);
      });
    });
  });

  describe("constructor with custom ordering function", () => {
    describe("when custom comparator is provided", () => {
      it("uses custom ordering", () => {
        const events: Event[] = [
          {
            aggregateId: "1",
            timestamp: 1000,
            type: "span.ingestion.ingested",
            data: {},
          },
          {
            aggregateId: "1",
            timestamp: 2000,
            type: "trace.projection.reset",
            data: {},
          },
          {
            aggregateId: "1",
            timestamp: 3000,
            type: "trace.projection.recomputed",
            data: {},
          },
        ];

        // Reverse order comparator
        const stream = new EventStream("1", events, {
          ordering: (a, b) => b.timestamp - a.timestamp,
        });

        expect(stream.getEvents()[0]!.timestamp).toBe(3000);
      });
    });

    describe("when events array is empty", () => {
      it("creates empty stream", () => {
        const events: Event[] = [];

        const stream = new EventStream("1", events, {
          ordering: (a, b) => b.timestamp - a.timestamp,
        });

        expect(stream.isEmpty()).toBe(true);
      });
    });
  });

  describe("isEmpty", () => {
    describe("when stream has no events", () => {
      it("returns true", () => {
        const stream = new EventStream("1", []);

        expect(stream.isEmpty()).toBe(true);
      });
    });

    describe("when stream has events", () => {
      it("returns false", () => {
        const events: Event[] = [
          {
            aggregateId: "1",
            timestamp: 1000,
            type: "span.ingestion.ingested",
            data: {},
          },
        ];

        const stream = new EventStream("1", events);

        expect(stream.isEmpty()).toBe(false);
      });
    });
  });

  describe("getMetadata", () => {
    describe("when stream is empty", () => {
      it("returns null for first timestamp", () => {
        const stream = new EventStream("1", []);

        expect(stream.getMetadata().firstEventTimestamp).toBeNull();
      });

      it("returns null for last timestamp", () => {
        const stream = new EventStream("1", []);

        expect(stream.getMetadata().lastEventTimestamp).toBeNull();
      });
    });

    describe("when stream has events", () => {
      it("returns correct first timestamp", () => {
        const events: Event[] = [
          {
            aggregateId: "1",
            timestamp: 1000,
            type: "span.ingestion.ingested",
            data: {},
          },
          {
            aggregateId: "1",
            timestamp: 2000,
            type: "trace.projection.reset",
            data: {},
          },
        ];

        const stream = new EventStream("1", events);

        expect(stream.getMetadata().firstEventTimestamp).toBe(1000);
      });

      it("returns correct last timestamp", () => {
        const events: Event[] = [
          {
            aggregateId: "1",
            timestamp: 1000,
            type: "span.ingestion.ingested",
            data: {},
          },
          {
            aggregateId: "1",
            timestamp: 2000,
            type: "trace.projection.reset",
            data: {},
          },
        ];

        const stream = new EventStream("1", events);

        expect(stream.getMetadata().lastEventTimestamp).toBe(2000);
      });
    });

    describe("when aggregateId is numeric", () => {
      it("converts to string in metadata", () => {
        const events: Event<number>[] = [
          {
            aggregateId: 123,
            timestamp: 1000,
            type: "span.ingestion.ingested",
            data: {},
          },
        ];

        const stream = new EventStream(123, events);

        expect(stream.getMetadata().aggregateId).toBe("123");
      });
    });
  });

  describe("getAggregateId", () => {
    it("returns the aggregate id", () => {
      const stream = new EventStream("test-id", []);

      expect(stream.getAggregateId()).toBe("test-id");
    });
  });

  describe("getEvents", () => {
    it("returns the events array", () => {
      const events: Event[] = [
        {
          aggregateId: "1",
          timestamp: 1000,
          type: "span.ingestion.ingested",
          data: {},
        },
      ];

      const stream = new EventStream("1", events);

      expect(stream.getEvents()).toHaveLength(1);
    });
  });
});
