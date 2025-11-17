import { describe, it, expect } from "vitest";
import { EventStoreMemory } from "../eventStoreMemory";
import type { Event } from "../../library";

describe("EventStoreMemory - Event Validation", () => {
  const store = new EventStoreMemory<string, Event<string>>();
  const tenantId = "test-tenant";
  const aggregateType = "trace" as const;
  const context = { tenantId };

  describe("storeEvents", () => {
    it("rejects invalid events - missing aggregateId", async () => {
      const invalidEvent = {
        timestamp: 1000,
        type: "TEST" as any,
        data: {},
      } as any;

      await expect(
        store.storeEvents([invalidEvent], context, aggregateType),
      ).rejects.toThrow("[VALIDATION] Invalid event at index 0");
    });

    it("rejects invalid events - missing timestamp", async () => {
      const invalidEvent = {
        aggregateId: "test-1",
        type: "TEST" as any,
        data: {},
      } as any;

      await expect(
        store.storeEvents([invalidEvent], context, aggregateType),
      ).rejects.toThrow("[VALIDATION] Invalid event at index 0");
    });

    it("rejects invalid events - missing type", async () => {
      const invalidEvent = {
        aggregateId: "test-1",
        timestamp: 1000,
        data: {},
      } as any;

      await expect(
        store.storeEvents([invalidEvent], context, aggregateType),
      ).rejects.toThrow("[VALIDATION] Invalid event at index 0");
    });

    it("rejects invalid events - missing data", async () => {
      const invalidEvent = {
        aggregateId: "test-1",
        timestamp: 1000,
        type: "TEST" as any,
      } as any;

      await expect(
        store.storeEvents([invalidEvent], context, aggregateType),
      ).rejects.toThrow("[VALIDATION] Invalid event at index 0");
    });

    it("rejects events with tenantId mismatch", async () => {
      const event = {
        aggregateId: "test-1",
        timestamp: 1000,
        type: "TEST" as any,
        data: {},
        metadata: { tenantId: "different-tenant" },
      };

      await expect(
        store.storeEvents([event], context, aggregateType),
      ).rejects.toThrow("[SECURITY] Event at index 0 has tenantId");
    });

    it("accepts valid events with matching tenantId in metadata", async () => {
      const event = {
        aggregateId: "test-1",
        timestamp: 1000,
        type: "TEST" as any,
        data: {},
        metadata: { tenantId },
      };

      await expect(
        store.storeEvents([event], context, aggregateType),
      ).resolves.not.toThrow();
    });

    it("accepts valid events without tenantId in metadata", async () => {
      const event = {
        aggregateId: "test-1",
        timestamp: 1000,
        type: "TEST" as any,
        data: {},
      };

      await expect(
        store.storeEvents([event], context, aggregateType),
      ).resolves.not.toThrow();
    });

    it("rejects batch with one invalid event", async () => {
      const validEvent = {
        aggregateId: "test-1",
        timestamp: 1000,
        type: "TEST" as any,
        data: {},
      };
      const invalidEvent = {
        aggregateId: "test-2",
        timestamp: 1000,
        type: "TEST" as any,
        // missing data
      } as any;

      await expect(
        store.storeEvents([validEvent, invalidEvent], context, aggregateType),
      ).rejects.toThrow("[VALIDATION] Invalid event at index 1");
    });

    it("rejects batch with tenantId mismatch in second event", async () => {
      const validEvent = {
        aggregateId: "test-1",
        timestamp: 1000,
        type: "TEST" as any,
        data: {},
      };
      const mismatchedEvent = {
        aggregateId: "test-2",
        timestamp: 1000,
        type: "TEST" as any,
        data: {},
        metadata: { tenantId: "different-tenant" },
      };

      await expect(
        store.storeEvents(
          [validEvent, mismatchedEvent],
          context,
          aggregateType,
        ),
      ).rejects.toThrow("[SECURITY] Event at index 1 has tenantId");
    });

    it("accepts empty event array", async () => {
      await expect(
        store.storeEvents([], context, aggregateType),
      ).resolves.not.toThrow();
    });
  });
});
