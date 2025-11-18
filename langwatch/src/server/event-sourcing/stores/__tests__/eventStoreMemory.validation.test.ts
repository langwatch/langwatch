import { describe, it, expect } from "vitest";
import { EventStoreMemory } from "../eventStoreMemory";
import type { Event } from "../../library";
import { createTenantId } from "../../library/core/tenantId";
import { createEventStoreValidationTests } from "./shared/eventStoreValidation.test-utils";

createEventStoreValidationTests({
  describe,
  it,
  expect,
  createStore: () => new EventStoreMemory<string, Event<string>>(),
  aggregateType: "trace" as const,
  getStoreName: () => "EventStoreMemory",
});

describe("EventStoreMemory - Event Validation", () => {
  const store = new EventStoreMemory<string, Event<string>>();
  const tenantId = createTenantId("test-tenant");
  const aggregateType = "trace" as const;
  const context = { tenantId };

  describe("storeEvents", () => {
    it("rejects events without tenantId", async () => {
      const event = {
        aggregateId: "test-1",
        timestamp: 1000,
        type: "TEST" as any,
        data: {},
      } as any;

      await expect(
        store.storeEvents([event], context, aggregateType),
      ).rejects.toThrow();
    });
  });
});
