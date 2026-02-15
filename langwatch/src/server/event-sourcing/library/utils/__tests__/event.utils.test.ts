import { describe, expect, it } from "vitest";
import type { AggregateType } from "../../domain/aggregateType";
import { EVENT_TYPES } from "../../domain/eventType";
import { createTenantId } from "../../domain/tenantId";
import { EventUtils } from "../event.utils";

describe("EventUtils - Event ID", () => {
  const tenantId = createTenantId("test-tenant");
  const aggregateId = "test-aggregate";
  const eventVersion = "2025-12-17";
  const aggregateType = "test_aggregate" as AggregateType;
  const eventType = EVENT_TYPES[0];

  describe("createEvent - event ID format", () => {
    it("generates event ID in correct format: {timestamp}:{tenantId}:{aggregateId}:{aggregateType}", () => {
      const timestamp = 1000000;
      const event = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { test: "data" },
        timestamp,
      });

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

      const event1 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { test: "data" },
        timestamp: timestamp1,
      });

      const event2 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { test: "data" },
        timestamp: timestamp2, // Different timestamp = different Event ID
      });

      // IDs should be different due to different timestamps
      expect(event1.id).not.toBe(event2.id);
    });

    it("includes correct timestamp, tenantId, aggregateId, and aggregateType in event ID", () => {
      const timestamp = 1234567890;
      const customAggregateId = "custom-aggregate-123";
      const customAggregateType = "custom_type" as AggregateType;

      const event = EventUtils.createEvent({
        aggregateType: customAggregateType,
        aggregateId: customAggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { test: "data" },
        timestamp,
      });

      const parts = event.id.split(":");
      expect(parts[0]).toBe(String(timestamp));
      expect(parts[1]).toBe(String(tenantId));
      expect(parts[2]).toBe(customAggregateId);
      expect(parts[3]).toBe(customAggregateType);
    });
  });

  describe("createEvent - occurredAt", () => {
    it("defaults occurredAt to timestamp when not provided", () => {
      const timestamp = 5000000;
      const event = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { test: "data" },
        timestamp,
      });

      expect(event.occurredAt).toBe(timestamp);
    });

    it("uses provided occurredAt from options", () => {
      const timestamp = 5000000;
      const occurredAt = 4000000;
      const event = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { test: "data" },
        timestamp,
        occurredAt,
      });

      expect(event.occurredAt).toBe(occurredAt);
      expect(event.timestamp).toBe(timestamp);
    });

    it("sets occurredAt to auto-generated timestamp when neither is provided", () => {
      const before = Date.now();
      const event = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { test: "data" },
      });
      const after = Date.now();

      expect(event.occurredAt).toBe(event.timestamp);
      expect(event.occurredAt).toBeGreaterThanOrEqual(before);
      expect(event.occurredAt).toBeLessThanOrEqual(after);
    });
  });

  describe("createEvent with trace context - event ID format", () => {
    it("generates event ID in correct format", () => {
      const timestamp = 2000000;
      const event = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { test: "data" },
        timestamp,
        includeTraceContext: true,
      });

      const parts = event.id.split(":");
      expect(parts.length).toBeGreaterThanOrEqual(5); // At least 5 parts (timestamp, tenantId, aggregateId, aggregateType, ksuid)
      expect(parts[0]).toBe(String(timestamp));
      expect(parts[1]).toBe(String(tenantId));
      expect(parts[2]).toBe(aggregateId);
      expect(parts[3]).toBe(aggregateType);
    });
  });
});
