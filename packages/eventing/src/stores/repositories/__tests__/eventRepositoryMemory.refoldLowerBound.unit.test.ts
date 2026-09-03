import { describe, expect, it } from "vitest";
import type { EventRecord } from "../eventRepository.types";
import { EventRepositoryMemory } from "../eventRepositoryMemory";

/**
 * The re-fold reads (`getEventRecordsUpTo` and its paged twin) take an
 * `occurredAtFromMs` lower bound so ClickHouse can prune `event_log`'s weekly
 * partitions. The in-memory repository mirrors that filter ON PURPOSE: a window
 * too small to cover an aggregate's lifetime must drop events HERE, in tests,
 * rather than only in production against real data.
 *
 * That mirror is the whole safety argument, so it needs its own tests — without
 * them an inverted comparison or a dropped unknown-time check would pass every
 * suite and the mirror would quietly stop mirroring.
 *
 * Unknown occurred times are kept: the SQL says `EventOccurredAt = 0 OR ...`,
 * and the memory record type also allows null, so both spellings of "unknown"
 * survive the bound.
 */
function record({
  eventId,
  occurredAt,
}: {
  eventId: string;
  occurredAt: number | null;
}): EventRecord {
  return {
    TenantId: "tenant",
    AggregateType: "trace",
    AggregateId: "agg",
    EventId: eventId,
    // Kept distinct from EventOccurredAt: the upper bound is on EventTimestamp
    // (acceptance order) and must not be what the lower bound is read from.
    EventTimestamp: 1000,
    EventOccurredAt: occurredAt,
    EventType: "test.event",
    EventVersion: "1",
    EventPayload: {},
    ProcessingTraceparent: "",
    IdempotencyKey: eventId,
  };
}

const bound = 1_700_000_000_000;

async function seeded() {
  const repo = EventRepositoryMemory.createForTesting();
  await repo.insertEventRecords([
    record({ eventId: "before", occurredAt: bound - 1000 }), // older than the bound
    record({ eventId: "at", occurredAt: bound }), // exactly at the bound
    record({ eventId: "after", occurredAt: bound + 1000 }), // newer than the bound
    // Unknown occurred time, as ClickHouse spells it
    record({ eventId: "unknown-zero", occurredAt: 0 }),
    // Unknown occurred time, as the memory type allows
    record({ eventId: "unknown-null", occurredAt: null }),
  ]);
  return repo;
}

// Above every record's EventTimestamp, so the upper bound excludes nothing
// and each assertion below is about the lower bound alone.
const upToTimestamp = 2000;
const upToEventId = "zzz";

const ALL_IDS = ["before", "at", "after", "unknown-zero", "unknown-null"];
const WITHIN_BOUND = ["at", "after", "unknown-zero", "unknown-null"];

async function readUnpaged(
  repo: EventRepositoryMemory,
  occurredAtFromMs?: number,
): Promise<string[]> {
  const records = await repo.getEventRecordsUpTo({
    tenantId: "tenant",
    aggregateType: "trace",
    aggregateId: "agg",
    upToTimestamp,
    upToEventId,
    occurredAtFromMs,
  });
  return records.map((r) => r.EventId);
}

async function readPaged(
  repo: EventRepositoryMemory,
  occurredAtFromMs?: number,
): Promise<string[]> {
  const records = await repo.getEventRecordsUpToPaged({
    tenantId: "tenant",
    aggregateType: "trace",
    aggregateId: "agg",
    upToTimestamp,
    upToEventId,
    after: undefined,
    limit: 100,
    occurredAtFromMs,
  });
  return records.map((r) => r.EventId);
}

describe("EventRepositoryMemory mirrors the re-fold lower bound", () => {
  describe("given events seeded either side of the bound, and two with an unknown occurred time", () => {
    describe("when getEventRecordsUpTo reads without a lower bound", () => {
      it("returns every event", async () => {
        const ids = await readUnpaged(await seeded());

        expect(new Set(ids)).toEqual(new Set(ALL_IDS));
      });
    });

    describe("when getEventRecordsUpTo reads with the lower bound", () => {
      it("drops events older than the bound and keeps unknown occurred times", async () => {
        const ids = await readUnpaged(await seeded(), bound);

        expect(new Set(ids)).toEqual(new Set(WITHIN_BOUND));
        expect(ids).not.toContain("before");
      });
    });

    describe("when getEventRecordsUpToPaged reads without a lower bound", () => {
      it("returns every event", async () => {
        const ids = await readPaged(await seeded());

        expect(new Set(ids)).toEqual(new Set(ALL_IDS));
      });
    });

    describe("when getEventRecordsUpToPaged reads with the lower bound", () => {
      it("applies the same bound as the unpaged read", async () => {
        const ids = await readPaged(await seeded(), bound);

        expect(new Set(ids)).toEqual(new Set(WITHIN_BOUND));
        expect(ids).not.toContain("before");
      });
    });
  });
});
