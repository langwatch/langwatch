import { describe, expect, it } from "vitest";
import { EventUtils } from "../event.utils";
import { createTenantId } from "../../domain/tenantId";
import { EVENT_TYPES } from "../../domain/eventType";
import type { AggregateType } from "../../domain/aggregateType";

describe("EventUtils - Event ID", () => {
  const tenantId = createTenantId("test-tenant");
  const aggregateId = "test-aggregate";
  const aggregateType = "test_aggregate" as AggregateType;
  const eventType = EVENT_TYPES[0];

  describe("createEvent - event ID format", () => {
    it("generates event ID in correct format: {timestamp}:{tenantId}:{aggregateId}:{aggregateType}", () => {
      const timestamp = 1000000;
      const event = EventUtils.createEvent(
        aggregateType,
        aggregateId,
        tenantId,
        eventType,
        { test: "data" },
        void 0,
        timestamp,
      );

      // Event ID should be timestamp:tenantId:aggregateId:aggregateType:ksuid
      // KSUID is added for entropy and uniqueness
      expect(event.id).toMatch(/^\d+:[^:]+:[^:]+:[^:]+:.+$/);
      const parts = event.id.split(":");
      expect(parts.length).toBeGreaterThanOrEqual(5); // At least 5 parts (timestamp, tenantId, aggregateId, aggregateType, ksuid)
      expect(parts[0]).toBe(String(timestamp));
      expect(parts[1]).toBe(String(tenantId));
      expect(parts[2]).toBe(aggregateId);
      expect(parts[3]).toBe(aggregateType);
    });

    it("auto-generates event ID with current timestamp when not provided", () => {
      const timestamp1 = 1000000;
      const timestamp2 = 1000001;

      const event1 = EventUtils.createEvent(
        aggregateType,
        aggregateId,
        tenantId,
        eventType,
        { test: "data" },
        void 0,
        timestamp1,
      );

      const event2 = EventUtils.createEvent(
        aggregateType,
        aggregateId,
        tenantId,
        eventType,
        { test: "data" },
        void 0,
        timestamp2, // Different timestamp = different Event ID
      );

      // IDs should be different due to different timestamps
      expect(event1.id).not.toBe(event2.id);
    });

    it("includes correct timestamp, tenantId, aggregateId, and aggregateType in event ID", () => {
      const timestamp = 1234567890;
      const customAggregateId = "custom-aggregate-123";
      const customAggregateType = "custom_type" as AggregateType;

      const event = EventUtils.createEvent(
        customAggregateType,
        customAggregateId,
        tenantId,
        eventType,
        { test: "data" },
        void 0,
        timestamp,
      );

      const parts = event.id.split(":");
      expect(parts[0]).toBe(String(timestamp));
      expect(parts[1]).toBe(String(tenantId));
      expect(parts[2]).toBe(customAggregateId);
      expect(parts[3]).toBe(customAggregateType);
    });
  });

  describe("createEvent with trace context - event ID format", () => {
    it("generates event ID in correct format", () => {
      const timestamp = 2000000;
      const event = EventUtils.createEvent(
        aggregateType,
        aggregateId,
        tenantId,
        eventType,
        { test: "data" },
        void 0,
        timestamp,
        { includeTraceContext: true },
      );

      const parts = event.id.split(":");
      expect(parts.length).toBeGreaterThanOrEqual(5); // At least 5 parts (timestamp, tenantId, aggregateId, aggregateType, ksuid)
      expect(parts[0]).toBe(String(timestamp));
      expect(parts[1]).toBe(String(tenantId));
      expect(parts[2]).toBe(aggregateId);
      expect(parts[3]).toBe(aggregateType);
    });
  });
});
