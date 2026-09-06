import { describe, expect, it } from "vitest";
import type { EventRecord } from "../eventRepository.types";
import { EventRepositoryMemory } from "../eventRepositoryMemory";

function record(eventId: string, occurredAt: number | null): EventRecord {
  return {
    TenantId: "tenant",
    AggregateType: "trace",
    AggregateId: "agg",
    EventId: eventId,
    EventTimestamp: occurredAt ?? 0,
    EventOccurredAt: occurredAt,
    EventType: "test.integration.event",
    EventVersion: "1",
    EventPayload: {},
    ProcessingTraceparent: "",
    IdempotencyKey: eventId,
  };
}

describe("EventRepositoryMemory.getEventRecords lower bound", () => {
  const bound = 1_700_000_000_000;

  async function seeded() {
    const repo = new EventRepositoryMemory();
    await repo.insertEventRecords([
      record("before", bound - 1000), // older than the bound
      record("at", bound), // exactly at the bound
      record("after", bound + 1000), // newer than the bound
      record("unknown-time", 0), // unknown occurred time
    ]);
    return repo;
  }

  describe("when no lower bound is passed", () => {
    it("returns every event", async () => {
      const repo = await seeded();
      const ids = (await repo.getEventRecords("tenant", "trace", "agg")).map(
        (r) => r.EventId,
      );
      expect(new Set(ids)).toEqual(
        new Set(["before", "at", "after", "unknown-time"]),
      );
    });
  });

  describe("when a lower bound is passed", () => {
    it("keeps events at/after the bound and unknown-time events, drops older ones", async () => {
      const repo = await seeded();
      const ids = (
        await repo.getEventRecords("tenant", "trace", "agg", bound)
      ).map((r) => r.EventId);

      expect(new Set(ids)).toEqual(new Set(["at", "after", "unknown-time"]));
      expect(ids).not.toContain("before");
    });
  });
});
