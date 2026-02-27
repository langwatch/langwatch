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
    it("generates a KSUID-based event ID", () => {
      const event = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { test: "data" },
        timestamp: 1000000,
      });

      expect(event.id).toMatch(/^event_/);
      expect(event.id).not.toContain(":");
    });

    it("generates unique IDs for different events", () => {
      const event1 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { test: "data" },
        timestamp: 1000000,
      });

      const event2 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { test: "data" },
        timestamp: 1000001,
      });

      expect(event1.id).not.toBe(event2.id);
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
    it("generates a KSUID-based event ID", () => {
      const event = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { test: "data" },
        timestamp: 2000000,
        includeTraceContext: true,
      });

      expect(event.id).toMatch(/^event_/);
      expect(event.id).not.toContain(":");
    });
  });
});
