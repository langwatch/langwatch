import { describe, it, expect } from "vitest";
import { EventUtils } from "../event.utils";

describe("EventUtils - Validation Edge Cases", () => {
  describe("isValidEvent", () => {
    describe("when data is null", () => {
      it("returns true (null is valid data)", () => {
        const event = {
          aggregateId: "test-123",
          timestamp: 1234567890,
          type: "TEST",
          data: null,
        };

        expect(EventUtils.isValidEvent(event)).toBe(true);
      });
    });

    describe("when data is explicitly undefined", () => {
      it("returns false", () => {
        const event = {
          aggregateId: "test-123",
          timestamp: 1234567890,
          type: "TEST",
          data: void 0,
        };

        expect(EventUtils.isValidEvent(event)).toBe(false);
      });
    });

    describe("when aggregateId is null", () => {
      it("returns false", () => {
        const event = {
          aggregateId: null,
          timestamp: 1234567890,
          type: "TEST",
          data: {},
        };

        expect(EventUtils.isValidEvent(event)).toBe(false);
      });
    });

    describe("when aggregateId is zero", () => {
      it("returns true (zero is valid)", () => {
        const event = {
          aggregateId: 0,
          timestamp: 1234567890,
          type: "TEST",
          data: {},
        };

        expect(EventUtils.isValidEvent(event)).toBe(true);
      });
    });

    describe("when aggregateId is empty string", () => {
      it("returns true (empty string is technically valid)", () => {
        const event = {
          aggregateId: "",
          timestamp: 1234567890,
          type: "TEST",
          data: {},
        };

        expect(EventUtils.isValidEvent(event)).toBe(true);
      });
    });

    describe("when timestamp is zero", () => {
      it("returns true (epoch zero is valid)", () => {
        const event = {
          aggregateId: "test-123",
          timestamp: 0,
          type: "TEST",
          data: {},
        };

        expect(EventUtils.isValidEvent(event)).toBe(true);
      });
    });

    describe("when timestamp is negative", () => {
      it("returns true (pre-epoch is valid)", () => {
        const event = {
          aggregateId: "test-123",
          timestamp: -1000,
          type: "TEST",
          data: {},
        };

        expect(EventUtils.isValidEvent(event)).toBe(true);
      });
    });

    describe("when timestamp is NaN", () => {
      it("returns false", () => {
        const event = {
          aggregateId: "test-123",
          timestamp: NaN,
          type: "TEST",
          data: {},
        };

        expect(EventUtils.isValidEvent(event)).toBe(false);
      });
    });

    describe("when timestamp is Infinity", () => {
      it("returns true (Infinity is a number)", () => {
        const event = {
          aggregateId: "test-123",
          timestamp: Infinity,
          type: "TEST",
          data: {},
        };

        expect(EventUtils.isValidEvent(event)).toBe(true);
      });
    });

    describe("when type is empty string", () => {
      it("returns true (empty type is valid string)", () => {
        const event = {
          aggregateId: "test-123",
          timestamp: 1234567890,
          type: "",
          data: {},
        };

        expect(EventUtils.isValidEvent(event)).toBe(true);
      });
    });

    describe("when type is null", () => {
      it("returns false", () => {
        const event = {
          aggregateId: "test-123",
          timestamp: 1234567890,
          type: null,
          data: {},
        };

        expect(EventUtils.isValidEvent(event)).toBe(false);
      });
    });

    describe("when event has extra fields", () => {
      it("returns true (extra fields allowed)", () => {
        const event = {
          aggregateId: "test-123",
          timestamp: 1234567890,
          type: "TEST",
          data: {},
          extraField: "extra",
          metadata: { custom: "data" },
        };

        expect(EventUtils.isValidEvent(event)).toBe(true);
      });
    });
  });

  describe("isValidProjection", () => {
    describe("when data is null", () => {
      it("returns true (null is valid data)", () => {
        const projection = {
          id: "proj-123",
          aggregateId: "test-123",
          version: 1234567890,
          data: null,
        };

        expect(EventUtils.isValidProjection(projection)).toBe(true);
      });
    });

    describe("when data is explicitly undefined", () => {
      it("returns false", () => {
        const projection = {
          id: "proj-123",
          aggregateId: "test-123",
          version: 1234567890,
          data: void 0,
        };

        expect(EventUtils.isValidProjection(projection)).toBe(false);
      });
    });

    describe("when id is empty string", () => {
      it("returns true (empty string is valid)", () => {
        const projection = {
          id: "",
          aggregateId: "test-123",
          version: 1234567890,
          data: {},
        };

        expect(EventUtils.isValidProjection(projection)).toBe(true);
      });
    });

    describe("when id is null", () => {
      it("returns false", () => {
        const projection = {
          id: null,
          aggregateId: "test-123",
          version: 1234567890,
          data: {},
        };

        expect(EventUtils.isValidProjection(projection)).toBe(false);
      });
    });

    describe("when id is number", () => {
      it("returns false (must be string)", () => {
        const projection = {
          id: 123,
          aggregateId: "test-123",
          version: 1234567890,
          data: {},
        };

        expect(EventUtils.isValidProjection(projection)).toBe(false);
      });
    });

    describe("when aggregateId is zero", () => {
      it("returns true (zero is valid)", () => {
        const projection = {
          id: "proj-123",
          aggregateId: 0,
          version: 1234567890,
          data: {},
        };

        expect(EventUtils.isValidProjection(projection)).toBe(true);
      });
    });

    describe("when aggregateId is null", () => {
      it("returns false", () => {
        const projection = {
          id: "proj-123",
          aggregateId: null,
          version: 1234567890,
          data: {},
        };

        expect(EventUtils.isValidProjection(projection)).toBe(false);
      });
    });

    describe("when version is zero", () => {
      it("returns true (version 0 is valid)", () => {
        const projection = {
          id: "proj-123",
          aggregateId: "test-123",
          version: 0,
          data: {},
        };

        expect(EventUtils.isValidProjection(projection)).toBe(true);
      });
    });

    describe("when version is negative", () => {
      it("returns true (negative version is technically valid)", () => {
        const projection = {
          id: "proj-123",
          aggregateId: "test-123",
          version: -1,
          data: {},
        };

        expect(EventUtils.isValidProjection(projection)).toBe(true);
      });
    });

    describe("when version is NaN", () => {
      it("returns false", () => {
        const projection = {
          id: "proj-123",
          aggregateId: "test-123",
          version: NaN,
          data: {},
        };

        expect(EventUtils.isValidProjection(projection)).toBe(false);
      });
    });

    describe("when version is Infinity", () => {
      it("returns true (Infinity is a number)", () => {
        const projection = {
          id: "proj-123",
          aggregateId: "test-123",
          version: Infinity,
          data: {},
        };

        expect(EventUtils.isValidProjection(projection)).toBe(true);
      });
    });

    describe("when projection has extra fields", () => {
      it("returns true (extra fields allowed)", () => {
        const projection = {
          id: "proj-123",
          aggregateId: "test-123",
          version: 1234567890,
          data: {},
          extraField: "extra",
          metadata: { custom: "data" },
        };

        expect(EventUtils.isValidProjection(projection)).toBe(true);
      });
    });

    describe("when projection is an array", () => {
      it("returns false", () => {
        const projection = [
          { id: "proj-123", aggregateId: "test-123", version: 1, data: {} },
        ];

        expect(EventUtils.isValidProjection(projection)).toBe(false);
      });
    });

    describe("when projection is a function", () => {
      it("returns false", () => {
        const projection = function () {
          return {
            id: "proj-123",
            aggregateId: "test-123",
            version: 1,
            data: {},
          };
        };

        expect(EventUtils.isValidProjection(projection)).toBe(false);
      });
    });
  });

  describe("sortEventsByTimestamp", () => {
    describe("when array contains NaN timestamps", () => {
      it("handles NaN timestamps without crashing", () => {
        const events = [
          { aggregateId: "1", timestamp: 2000, type: "B", data: {} },
          { aggregateId: "1", timestamp: NaN, type: "NaN", data: {} },
          { aggregateId: "1", timestamp: 1000, type: "A", data: {} },
        ];

        const sorted = EventUtils.sortEventsByTimestamp(events);

        // NaN comparisons are unpredictable in sorting
        // Just verify the function completes and finite values are still present
        expect(sorted).toHaveLength(3);
        const finiteValues = sorted.filter(e => !Number.isNaN(e.timestamp));
        expect(finiteValues).toHaveLength(2);
        const nanValues = sorted.filter(e => Number.isNaN(e.timestamp));
        expect(nanValues).toHaveLength(1);
      });
    });

    describe("when array contains Infinity", () => {
      it("sorts Infinity after finite values", () => {
        const events = [
          { aggregateId: "1", timestamp: 2000, type: "B", data: {} },
          { aggregateId: "1", timestamp: Infinity, type: "INF", data: {} },
          { aggregateId: "1", timestamp: 1000, type: "A", data: {} },
        ];

        const sorted = EventUtils.sortEventsByTimestamp(events);

        expect(sorted[0]!.timestamp).toBe(1000);
        expect(sorted[1]!.timestamp).toBe(2000);
        expect(sorted[2]!.timestamp).toBe(Infinity);
      });
    });

    describe("when array contains negative Infinity", () => {
      it("sorts negative Infinity before finite values", () => {
        const events = [
          { aggregateId: "1", timestamp: 1000, type: "A", data: {} },
          { aggregateId: "1", timestamp: -Infinity, type: "NEG_INF", data: {} },
          { aggregateId: "1", timestamp: 2000, type: "B", data: {} },
        ];

        const sorted = EventUtils.sortEventsByTimestamp(events);

        expect(sorted[0]!.timestamp).toBe(-Infinity);
        expect(sorted[1]!.timestamp).toBe(1000);
        expect(sorted[2]!.timestamp).toBe(2000);
      });
    });
  });
});

