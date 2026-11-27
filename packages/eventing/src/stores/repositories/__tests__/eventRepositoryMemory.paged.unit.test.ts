import { describe, expect, it } from "vitest";

import type { EventLogPageCursor } from "../../event-log-page-order.ts";
import type { EventRecord } from "../eventRepository.types.ts";
import { EventRepositoryMemory } from "../eventRepositoryMemory.ts";

/**
 * The cursor-paginated read the streaming re-fold walks so a huge aggregate
 * never loads whole. ClickHouse mirrors this exact cursor/order, so locking
 * the behaviour here guards both.
 */
function record({ eventId, ts, key }: { eventId: string; ts: number; key: string }): EventRecord {
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
    IdempotencyKey: key,
  };
}

const cursorAfter = (last: EventRecord): EventLogPageCursor => ({
  idempotencyKey: last.IdempotencyKey,
  timestamp: last.EventTimestamp,
  eventId: last.EventId,
});

describe("EventRepositoryMemory.getEventRecordsUpToPaged", () => {
  // Keys run against time order. e3a and e3b are two unmerged copies of key k3 at one timestamp
  // (tie-break by EventId); e5 is beyond the bound.
  async function seeded() {
    const repo = EventRepositoryMemory.createForTesting();
    await repo.insertEventRecords([
      record({ eventId: "e4", ts: 4000, key: "k1" }),
      record({ eventId: "e2", ts: 2000, key: "k2" }),
      record({ eventId: "e3b", ts: 3000, key: "k3" }),
      record({ eventId: "e1", ts: 1000, key: "k4" }),
      record({ eventId: "e3a", ts: 3000, key: "k3" }),
      record({ eventId: "e5", ts: 5000, key: "k0" }),
    ]);
    return repo;
  }

  // Include history up to AND including e4 — e5 (later) must be excluded.
  const request = {
    tenantId: "tenant",
    aggregateType: "trace",
    aggregateId: "agg",
    upToTimestamp: 4000,
    upToEventId: "e4",
  };

  async function walk(limit: number): Promise<string[][]> {
    const repo = await seeded();
    const pages: string[][] = [];
    let after: EventLogPageCursor | undefined;
    for (;;) {
      const page = await repo.getEventRecordsUpToPaged({ ...request, after, limit });
      if (page.length > 0) pages.push(page.map((r) => r.EventId));
      if (page.length < limit) return pages;
      after = cursorAfter(page[page.length - 1]!);
    }
  }

  describe("given a history and an upTo bound of e4", () => {
    it("pages in (idempotency key, timestamp, eventId) order, honouring the cursor and limit", async () => {
      expect(await walk(2)).toEqual([["e4", "e2"], ["e3a", "e3b"], ["e1"]]);
    });

    it("reads a copy of a key that falls past a page boundary", async () => {
      expect(await walk(3)).toEqual([
        ["e4", "e2", "e3a"],
        ["e3b", "e1"],
      ]);
    });
  });
});
