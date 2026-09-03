import { describe, expect, it, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ warn }),
}));

import { EventRepositoryMemory } from "../eventRepositoryMemory";

const duplicate = {
  TenantId: "tenant",
  AggregateType: "trace",
  AggregateId: "aggregate",
  EventId: "event",
  EventTimestamp: 1,
  EventOccurredAt: 1,
  EventType: "test.event",
  EventVersion: "1",
  EventPayload: {},
  ProcessingTraceparent: "",
  IdempotencyKey: "event",
};

describe("EventRepositoryMemory duplicate reporting", () => {
  it("keeps test factories quiet", async () => {
    const repository = EventRepositoryMemory.createForTesting();

    await repository.insertEventRecords([duplicate, duplicate]);

    expect(warn).not.toHaveBeenCalled();
  });

  it("reports a duplicate by default for a local process", async () => {
    const repository = EventRepositoryMemory.createForLocalDevelopment();

    await repository.insertEventRecords([duplicate, duplicate]);

    expect(warn).toHaveBeenCalledOnce();
  });
});
