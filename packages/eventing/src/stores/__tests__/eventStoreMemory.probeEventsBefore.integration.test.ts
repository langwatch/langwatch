import { beforeEach, describe, expect, it } from "vitest";

import { createTenantId } from "../../domain/tenantId.ts";
import { type AggregateType, EventUtils } from "../../index.ts";
import { TEST_EVENT_TYPES } from "../../services/__tests__/testHelpers.ts";
import { EventStoreMemory } from "../eventStoreMemory.ts";

describe("EventStoreMemory probeEventsBefore", () => {
  const tenantId = createTenantId("test-tenant");
  const context = { tenantId };
  const aggregateId = "test-aggregate";
  const aggregateType: AggregateType = "trace";

  let store: EventStoreMemory;

  const eventAt = (createdAt: number) =>
    EventUtils.createEvent({
      aggregateType,
      aggregateId,
      tenantId,
      type: TEST_EVENT_TYPES[0],
      version: "2025-12-17",
      data: { value: createdAt },
      createdAt,
    });

  beforeEach(() => {
    store = EventStoreMemory.createForTesting();
  });

  it("shows the first event of an aggregate with nothing before it", async () => {
    const first = eventAt(1000);
    await store.storeEvents([first], context, aggregateType);

    const probe = await store.probeEventsBefore({
      aggregateId,
      context,
      aggregateType,
      event: first,
    });

    expect(probe).toEqual({ hasEvent: true, hasEarlierEvents: false });
  });

  it("shows the events accepted before a later one", async () => {
    const first = eventAt(1000);
    const second = eventAt(2000);
    await store.storeEvents([first, second], context, aggregateType);

    const probe = await store.probeEventsBefore({
      aggregateId,
      context,
      aggregateType,
      event: second,
    });

    expect(probe).toEqual({ hasEvent: true, hasEarlierEvents: true });
  });

  it("does not show an event the log has not stored", async () => {
    const stored = eventAt(1000);
    await store.storeEvents([stored], context, aggregateType);

    const probe = await store.probeEventsBefore({
      aggregateId,
      context,
      aggregateType,
      event: eventAt(2000),
    });

    expect(probe).toEqual({ hasEvent: false, hasEarlierEvents: true });
  });
});
