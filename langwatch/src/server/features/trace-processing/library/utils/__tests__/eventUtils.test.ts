import { describe, it, expect } from "vitest";
import {
  eventBelongsToAggregate,
  sortEventsByTimestamp,
  filterEventsByType,
  getLatestProjection,
  isValidEvent,
  isValidProjection,
  createEvent,
  createProjection,
  buildProjectionMetadata,
  createEventStream,
} from "../eventUtils";
import type { Event, Projection } from "../../core/types";

describe("eventBelongsToAggregate", () => {
  describe("when event belongs to aggregate", () => {
    it("returns true", () => {
      const event: Event = {
        aggregateId: "test-123",
        timestamp: Date.now(),
        type: "TEST",
        data: {},
      };

      expect(eventBelongsToAggregate(event, "test-123")).toBe(true);
    });
  });

  describe("when event does not belong to aggregate", () => {
    it("returns false", () => {
      const event: Event = {
        aggregateId: "test-123",
        timestamp: Date.now(),
        type: "TEST",
        data: {},
      };

      expect(eventBelongsToAggregate(event, "different-123")).toBe(false);
    });
  });
});

describe("sortEventsByTimestamp", () => {
  describe("when events are unsorted", () => {
    it("returns chronologically sorted events", () => {
      const events: Event[] = [
        { aggregateId: "1", timestamp: 3000, type: "C", data: {} },
        { aggregateId: "1", timestamp: 1000, type: "A", data: {} },
        { aggregateId: "1", timestamp: 2000, type: "B", data: {} },
      ];

      const sorted = sortEventsByTimestamp(events);

      expect(sorted[0]!.timestamp).toBe(1000);
    });
  });

  describe("when events are already sorted", () => {
    it("maintains order", () => {
      const events: Event[] = [
        { aggregateId: "1", timestamp: 1000, type: "A", data: {} },
        { aggregateId: "1", timestamp: 2000, type: "B", data: {} },
        { aggregateId: "1", timestamp: 3000, type: "C", data: {} },
      ];

      const sorted = sortEventsByTimestamp(events);

      expect(sorted[0]!.timestamp).toBe(1000);
    });
  });
});

describe("filterEventsByType", () => {
  describe("when events match type", () => {
    it("returns matching events", () => {
      const events: Event[] = [
        { aggregateId: "1", timestamp: 1000, type: "CREATE", data: {} },
        { aggregateId: "1", timestamp: 2000, type: "UPDATE", data: {} },
        { aggregateId: "1", timestamp: 3000, type: "CREATE", data: {} },
      ];

      const filtered = filterEventsByType(events, "CREATE");

      expect(filtered).toHaveLength(2);
    });
  });

  describe("when no events match type", () => {
    it("returns empty array", () => {
      const events: Event[] = [
        { aggregateId: "1", timestamp: 1000, type: "CREATE", data: {} },
        { aggregateId: "1", timestamp: 2000, type: "UPDATE", data: {} },
      ];

      const filtered = filterEventsByType(events, "DELETE");

      expect(filtered).toHaveLength(0);
    });
  });
});

describe("getLatestProjection", () => {
  describe("when projections array is empty", () => {
    it("returns null", () => {
      const projections: Projection[] = [];

      const latest = getLatestProjection(projections);

      expect(latest).toBeNull();
    });
  });

  describe("when projections have different versions", () => {
    it("returns highest version", () => {
      const projections: Projection[] = [
        { id: "1", aggregateId: "a", version: 100, data: {} },
        { id: "2", aggregateId: "a", version: 300, data: {} },
        { id: "3", aggregateId: "a", version: 200, data: {} },
      ];

      const latest = getLatestProjection(projections);

      expect(latest?.version).toBe(300);
    });
  });

  describe("when projections have same version", () => {
    it("returns one of them", () => {
      const projections: Projection[] = [
        { id: "1", aggregateId: "a", version: 100, data: {} },
        { id: "2", aggregateId: "a", version: 100, data: {} },
      ];

      const latest = getLatestProjection(projections);

      expect(latest?.version).toBe(100);
    });
  });
});

describe("isValidEvent", () => {
  describe("when event is valid", () => {
    it("returns true", () => {
      const event = {
        aggregateId: "test-123",
        timestamp: 1234567890,
        type: "TEST",
        data: { value: 42 },
      };

      expect(isValidEvent(event)).toBe(true);
    });
  });

  describe("when aggregateId is missing", () => {
    it("returns false", () => {
      const event = {
        timestamp: 1234567890,
        type: "TEST",
        data: { value: 42 },
      };

      expect(isValidEvent(event)).toBe(false);
    });
  });

  describe("when timestamp is not a number", () => {
    it("returns false", () => {
      const event = {
        aggregateId: "test-123",
        timestamp: "not-a-number",
        type: "TEST",
        data: { value: 42 },
      };

      expect(isValidEvent(event)).toBe(false);
    });
  });

  describe("when type is not a string", () => {
    it("returns false", () => {
      const event = {
        aggregateId: "test-123",
        timestamp: 1234567890,
        type: 123,
        data: { value: 42 },
      };

      expect(isValidEvent(event)).toBe(false);
    });
  });

  describe("when data is undefined", () => {
    it("returns false", () => {
      const event = {
        aggregateId: "test-123",
        timestamp: 1234567890,
        type: "TEST",
      };

      expect(isValidEvent(event)).toBe(false);
    });
  });

  describe("when event is null", () => {
    it("returns false", () => {
      expect(isValidEvent(null)).toBeFalsy();
    });
  });

  describe("when event is undefined", () => {
    it("returns false", () => {
      expect(isValidEvent(void 0)).toBeFalsy();
    });
  });
});

describe("isValidProjection", () => {
  describe("when projection is valid", () => {
    it("returns true", () => {
      const projection = {
        id: "proj-123",
        aggregateId: "test-123",
        version: 1234567890,
        data: { value: 42 },
      };

      expect(isValidProjection(projection)).toBe(true);
    });
  });

  describe("when id is not a string", () => {
    it("returns false", () => {
      const projection = {
        id: 123,
        aggregateId: "test-123",
        version: 1234567890,
        data: { value: 42 },
      };

      expect(isValidProjection(projection)).toBe(false);
    });
  });

  describe("when aggregateId is missing", () => {
    it("returns false", () => {
      const projection = {
        id: "proj-123",
        version: 1234567890,
        data: { value: 42 },
      };

      expect(isValidProjection(projection)).toBe(false);
    });
  });

  describe("when version is not a number", () => {
    it("returns false", () => {
      const projection = {
        id: "proj-123",
        aggregateId: "test-123",
        version: "not-a-number",
        data: { value: 42 },
      };

      expect(isValidProjection(projection)).toBe(false);
    });
  });

  describe("when data is undefined", () => {
    it("returns false", () => {
      const projection = {
        id: "proj-123",
        aggregateId: "test-123",
        version: 1234567890,
      };

      expect(isValidProjection(projection)).toBe(false);
    });
  });

  describe("when projection is null", () => {
    it("returns false", () => {
      expect(isValidProjection(null)).toBe(false);
    });
  });

  describe("when projection is undefined", () => {
    it("returns false", () => {
      expect(isValidProjection(void 0)).toBe(false);
    });
  });
});

