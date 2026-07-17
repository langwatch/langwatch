import { describe, expect, it } from "vitest";
import type { EventRecord } from "../eventRepository.types";
import { EventRepositoryMemory } from "../eventRepositoryMemory";

/**
 * `getEventRecordsUpToPaged` is the cursor-paginated read the streaming
 * store-miss re-fold walks so a huge aggregate's history never lands in memory
 * whole. The ClickHouse repository mirrors this exact cursor + upper-bound +
 * (EventTimestamp, EventId) order, so locking the behaviour here guards both.
 */
function record({ eventId, ts }: { eventId: string; ts: number }): EventRecord {
  return {
    TenantId: "tenant",
    AggregateType: "trace",
    AggregateId: "agg",
    EventId: eventId,
    EventTimestamp: ts,
    EventOccurredAt: ts,
    EventType: "test.event",
    EventVersion: "1",
    EventPayload: {},
    ProcessingTraceparent: "",
    IdempotencyKey: eventId,
  };
}

describe("EventRepositoryMemory.getEventRecordsUpToPaged", () => {
  // e3a and e3b share a timestamp (tiebreak by EventId); e5 is beyond the bound.
  async function seeded() {
    const repo = new EventRepositoryMemory();
    await repo.insertEventRecords([
      record({ eventId: "e4", ts: 4000 }),
      record({ eventId: "e2", ts: 2000 }),
      record({ eventId: "e3b", ts: 3000 }),
      record({ eventId: "e1", ts: 1000 }),
      record({ eventId: "e3a", ts: 3000 }),
      record({ eventId: "e5", ts: 5000 }),
    ]);
    return repo;
  }

  // Include history up to AND including e4 — e5 (later) must be excluded.
  const upTo = { ts: 4000, id: "e4" };

  describe("given a history and an upTo bound of e4", () => {
    it("pages in (timestamp, eventId) order, honouring the after cursor and limit", async () => {
      const repo = await seeded();

      const page1 = await repo.getEventRecordsUpToPaged({
        tenantId: "tenant",
        aggregateType: "trace",
        aggregateId: "agg",
        upToTimestamp: upTo.ts,
        upToEventId: upTo.id,
        after: undefined,
        limit: 2,
      });
      expect(page1.map((r) => r.EventId)).toEqual(["e1", "e2"]);

      const c1 = page1[page1.length - 1]!;
      const page2 = await repo.getEventRecordsUpToPaged({
        tenantId: "tenant",
        aggregateType: "trace",
        aggregateId: "agg",
        upToTimestamp: upTo.ts,
        upToEventId: upTo.id,
        after: { timestamp: c1.EventTimestamp, eventId: c1.EventId },
        limit: 2,
      });
      // Same-timestamp events tie-break by EventId.
      expect(page2.map((r) => r.EventId)).toEqual(["e3a", "e3b"]);

      const c2 = page2[page2.length - 1]!;
      const page3 = await repo.getEventRecordsUpToPaged({
        tenantId: "tenant",
        aggregateType: "trace",
        aggregateId: "agg",
        upToTimestamp: upTo.ts,
        upToEventId: upTo.id,
        after: { timestamp: c2.EventTimestamp, eventId: c2.EventId },
        limit: 2,
      });
      // e4 is the last within the bound; e5 is excluded.
      expect(page3.map((r) => r.EventId)).toEqual(["e4"]);
    });

    it("walks the whole bounded history across pages and stops at the bound", async () => {
      const repo = await seeded();
      const all: string[] = [];
      let after: { timestamp: number; eventId: string } | undefined;

      for (;;) {
        const page = await repo.getEventRecordsUpToPaged({
          tenantId: "tenant",
          aggregateType: "trace",
          aggregateId: "agg",
          upToTimestamp: upTo.ts,
          upToEventId: upTo.id,
          after,
          limit: 2,
        });
        if (page.length === 0) break;
        all.push(...page.map((r) => r.EventId));
        const last = page[page.length - 1]!;
        after = { timestamp: last.EventTimestamp, eventId: last.EventId };
        if (page.length < 2) break;
      }

      expect(all).toEqual(["e1", "e2", "e3a", "e3b", "e4"]);
      expect(all).not.toContain("e5");
    });
  });
});
