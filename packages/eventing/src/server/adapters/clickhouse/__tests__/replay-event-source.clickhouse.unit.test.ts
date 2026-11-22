/** Spec: packages/eventing/specs/projection-replay.feature */
import type { QueryRequest } from "@langwatch/clickhouse-client";
import {
  type ClickHouseEventRow,
  EventingClickHouseReplayEventSource,
  type EventingClickHouseReplayClient,
  getAggregateOccurredAtBounds,
} from "@langwatch/eventing/server";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it, vi } from "vitest";

import { pageAggregateEvents } from "../../../../replay/replayEngine.ts";
import type { ReplayEvent } from "../../../../replay/replayEventSource.ts";
import {
  rowsWithinPayload,
  sliceByBudget,
  streamSliceOrHalves,
} from "../replay-event-source.clickhouse.ts";

const row = (eventId: string, timestamp: number): ClickHouseEventRow => ({
  TenantId: "project_a",
  AggregateType: "trace",
  AggregateId: "trace_1",
  EventId: eventId,
  EventType: "lw.span.received",
  EventTimestamp: timestamp,
  EventOccurredAt: timestamp,
  EventVersion: "2025-12-14",
  EventPayload: "{}",
});

/** One stored copy of an event: rows sharing a position are copies a merge has not collapsed. */
interface StoredCopy {
  copy: string;
  eventId: string;
  timestamp: number;
  payloadBytes: number;
}

const isAfter = (row: StoredCopy, at: { timestamp: number; eventId: string }) =>
  row.timestamp > at.timestamp || (row.timestamp === at.timestamp && row.eventId > at.eventId);

/** event_log as ClickHouse answers the page's two reads: the WHERE's range, then any LIMIT. */
function eventLogOf(copies: readonly StoredCopy[]): EventingClickHouseReplayClient {
  const at = (timestamp: unknown, eventId: unknown) => ({
    timestamp: Number(timestamp),
    eventId: String(eventId),
  });
  const inRange = (params: Record<string, unknown>) => {
    const upTo = at(params.maxCutoffTimestamp, params.maxCutoffEventId);
    const cursor = at(params.cursorTimestamp, params.cursorEventId);
    const hasCursor = params.cursorEventId !== undefined;
    return copies.filter((row) => !isAfter(row, upTo) && (!hasCursor || isAfter(row, cursor)));
  };
  const answer = ({ sql, params = {} }: QueryRequest): unknown[] => {
    const range = inRange(params);
    const read = sql.includes("LIMIT") ? range.slice(0, Number(params.batchSize)) : range;
    if (!sql.includes("AS payloadBytes")) {
      return read.map((copy) => ({
        ...row(copy.eventId, copy.timestamp),
        IdempotencyKey: copy.copy,
      }));
    }
    return read.map((copy) => ({
      EventTimestamp: copy.timestamp,
      EventId: copy.eventId,
      payloadBytes: copy.payloadBytes,
    }));
  };
  return clickHouseQueryClientDouble({
    query: async (request: QueryRequest) => ({ rows: answer(request) }),
  });
}

/** Every copy a paged read of the aggregate applies, in order, by its copy name. */
async function pagedCopies({ copies, maxEvents }: { copies: StoredCopy[]; maxEvents: number }) {
  const source = new EventingClickHouseReplayEventSource({
    clickhouse: eventLogOf(copies),
    lean: (event) => event,
  });
  const last = copies.at(-1)!;
  const applied: string[] = [];
  await pageAggregateEvents({
    eventSource: source,
    signal: undefined,
    log: { write: () => undefined },
    page: { maxEvents, maxPayloadBytes: 1_000 },
    tenantId: "project_a",
    aggregateIds: ["trace_1"],
    eventTypes: ["lw.span.received"],
    cutoffs: new Map([
      ["project_a:trace:trace_1", { timestamp: last.timestamp, eventId: last.eventId }],
    ]),
    onEvent: (event) => {
      applied.push(event.idempotencyKey);
    },
  });
  return applied;
}

/** The routed member's surface, answering nothing unless a test scripts it. */
function member() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    stream: vi.fn(),
    command: vi.fn().mockResolvedValue(undefined),
  };
  const clickhouse: EventingClickHouseReplayClient = client;
  return {
    client,
    source: new EventingClickHouseReplayEventSource({ clickhouse, lean: (e) => e }),
  };
}

describe("EventingClickHouseReplayEventSource", () => {
  describe("when a batch's events are read", () => {
    /** @scenario "A replay batch reads its events streamed rather than held whole" */
    it("applies each streamed batch as it arrives, from the batch's tenant", async () => {
      const { client, source } = member();
      client.stream.mockImplementation(async function* () {
        yield [row("event_1", 1), row("event_2", 2)];
        yield [row("event_3", 3)];
      });
      const applied: string[] = [];

      const { eventsApplied } = await source.streamEventsForAggregates({
        tenantId: "project_a",
        aggregateIds: ["trace_1"],
        eventTypes: ["lw.span.received"],
        cutoffs: new Map(),
        onEvent: (event) => {
          applied.push(event.id);
        },
      });

      expect(applied).toEqual(["event_1", "event_2", "event_3"]);
      expect(eventsApplied).toBe(3);
      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "project_a" }),
      );
      // Only the batch's sizes are read whole; its events arrive streamed.
      const wholeReads = client.query.mock.calls.map(([request]) => String(request.sql));
      expect(wholeReads).toHaveLength(1);
      expect(wholeReads[0]).toContain("sum(length(EventPayload))");
    });
  });

  describe("when a replay is asked for every tenant", () => {
    /** @scenario "A replay across every tenant discovers on the shared server, as main did" */
    it("names no tenant and gives its reason, so the member reads the shared server", async () => {
      const { client, source } = member();

      await source.discoverAffectedAggregates({ eventTypes: ["lw.span.received"], sinceMs: 0 });

      expect(client.query).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "",
          // The discovery sweep reads every tenant's events, so it must skip the check.
          SKIP_TENANT_CHECK: true,
        }),
      );
    });

    /** @scenario "A replay across every tenant discovers on the shared server, as main did" */
    it("names the tenant when the replay was asked for one", async () => {
      const { client, source } = member();

      await source.discoverAffectedAggregates({
        eventTypes: ["lw.span.received"],
        sinceMs: 0,
        tenantId: "project_a",
      });

      expect(client.query).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "project_a" }));
    });
  });

  describe("when a batch's occurred-at bounds are read", () => {
    /** @scenario "Replay's bounds read over a batch's aggregates is a declared full scan" */
    it("declares a full scan, since later reads in the batch prune by its answer", async () => {
      const { client } = member();

      await getAggregateOccurredAtBounds({
        client,
        tenantId: "project_a",
        aggregateTypes: ["trace"],
        aggregateIds: ["trace_1"],
      });

      expect(client.query).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "project_a", SKIP_COLD_SCAN_CHECK: true }),
      );
    });
  });

  describe("when a page of an aggregate's events is capped by payload bytes", () => {
    const page = {
      tenantId: "project_a",
      aggregateIds: ["trace_1"],
      eventTypes: ["lw.span.received"],
      maxCutoff: { timestamp: 9, eventId: "event_9" },
      batchSize: 1_000,
      maxPayloadBytes: 1_000,
    };

    /** @scenario "A page ends before its payloads pass the byte cap" */
    it("reads its events up to the last one whose payload fits, sorting no payload to size them", async () => {
      const { client, source } = member();
      client.query
        .mockResolvedValueOnce({
          rows: [
            { EventTimestamp: "1", EventId: "event_1", payloadBytes: "600" },
            { EventTimestamp: "2", EventId: "event_2", payloadBytes: "600" },
          ],
        })
        .mockResolvedValueOnce({ rows: [row("event_1", 1)] });

      const events = await source.loadAggregateEvents(page);

      expect(events.map((event) => event.id)).toEqual(["event_1"]);
      const [sizes, read] = client.query.mock.calls.map(([request]) => request);
      expect(sizes.sql).not.toContain("EventPayload,");
      expect(read.params).toMatchObject({ maxCutoffTimestamp: 1, maxCutoffEventId: "event_1" });
      expect(read.sql).not.toContain("LIMIT");
    });

    /** @scenario "A page ends before its payloads pass the byte cap" */
    it.each([
      {
        across: "the byte cap",
        maxEvents: 10,
        copies: [
          { copy: "copy_1", eventId: "event_1", timestamp: 1, payloadBytes: 400 },
          { copy: "copy_2", eventId: "event_2", timestamp: 2, payloadBytes: 400 },
          { copy: "copy_3", eventId: "event_2", timestamp: 2, payloadBytes: 400 },
          { copy: "copy_4", eventId: "event_3", timestamp: 3, payloadBytes: 100 },
        ],
      },
      {
        across: "the sizing read's LIMIT",
        maxEvents: 3,
        copies: [
          { copy: "copy_1", eventId: "event_1", timestamp: 1, payloadBytes: 400 },
          { copy: "copy_2", eventId: "event_2", timestamp: 2, payloadBytes: 400 },
          { copy: "copy_3", eventId: "event_2", timestamp: 2, payloadBytes: 400 },
          { copy: "copy_4", eventId: "event_2", timestamp: 2, payloadBytes: 400 },
          { copy: "copy_5", eventId: "event_3", timestamp: 3, payloadBytes: 100 },
        ],
      },
    ])("reads every copy of a tied event across $across once, none lost", async (each) => {
      const applied = await pagedCopies(each);

      expect(applied).toEqual(each.copies.map((stored) => stored.copy));
    });

    /** @scenario "A page ends before its payloads pass the byte cap" */
    it("reads nothing more once no event is left", async () => {
      const { client, source } = member();

      await expect(source.loadAggregateEvents(page)).resolves.toEqual([]);

      expect(client.query).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a rebuilt table is optimized", () => {
    /** @scenario "A rebuilt table is optimized on each touched tenant's own server" */
    it("names the tenant, so a private data plane's table is the one optimized", async () => {
      const { client, source } = member();

      await source.optimizeTables("project_a", ["stored_spans"]);

      expect(client.command).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "project_a", params: { table: "stored_spans" } }),
      );
    });
  });
});

describe("sliceByBudget", () => {
  const budget = { maxEvents: 10, maxPayloadBytes: 1_000 };
  const sizes = new Map([
    ["a", { events: 4, payloadBytes: 100 }],
    ["b", { events: 4, payloadBytes: 100 }],
    ["c", { events: 4, payloadBytes: 100 }],
    ["huge", { events: 50, payloadBytes: 5_000 }],
    ["heavy", { events: 1, payloadBytes: 950 }],
    ["d", { events: 1, payloadBytes: 200 }],
  ]);

  describe("when the batch's aggregates outgrow the budget together", () => {
    it("cuts them in order into slices within it, by events and by payload bytes", () => {
      const slices = sliceByBudget({ aggregateIds: ["a", "b", "c", "heavy", "d"], sizes, budget });

      expect(slices).toEqual([["a", "b"], ["c"], ["heavy"], ["d"]]);
    });
  });

  describe("when one aggregate alone is over the budget", () => {
    it("reads it in a slice of its own, never split", () => {
      const slices = sliceByBudget({ aggregateIds: ["a", "huge", "b"], sizes, budget });

      expect(slices).toEqual([["a"], ["huge"], ["b"]]);
    });
  });

  describe("when an aggregate has no sized row", () => {
    it("reads it with the slice it falls in", () => {
      const slices = sliceByBudget({ aggregateIds: ["a", "unsized", "b"], sizes, budget });

      expect(slices).toEqual([["a", "unsized", "b"]]);
    });
  });
});

describe("rowsWithinPayload", () => {
  const sized = (...rows: [eventId: string, payloadBytes: number][]) =>
    rows.map(([eventId, payloadBytes]) => ({ timestamp: 1, eventId, payloadBytes }));
  const within = (rows: ReturnType<typeof sized>, truncated = false) =>
    rowsWithinPayload({ rows, maxPayloadBytes: 1_000, truncated });

  describe("when a page's payloads pass the cap", () => {
    it("ends the page before the row that passes it", () => {
      expect(within(sized(["a", 400], ["b", 400], ["c", 400]))).toBe(2);
    });

    it("reads a first row over the cap alone", () => {
      expect(within(sized(["a", 5_000], ["b", 10]))).toBe(1);
    });

    /** @scenario "A page ends before its payloads pass the byte cap" */
    it("counts the copies tied at the page's end whole, ending before them", () => {
      expect(within(sized(["a", 300], ["b", 400], ["b", 400]))).toBe(1);
    });

    it("reads a first tied position over the cap whole, as its own page", () => {
      expect(within(sized(["a", 600], ["a", 600], ["b", 10]))).toBe(2);
    });
  });

  describe("when a page's payloads fit the cap", () => {
    it("reads every row, tied copies included", () => {
      expect(within(sized(["a", 300], ["b", 300], ["b", 300]))).toBe(3);
    });
  });

  describe("when the sizing read stopped at its LIMIT", () => {
    it("leaves its last position, which may hold unseen copies, to the next page", () => {
      expect(within(sized(["a", 100], ["b", 100], ["b", 100]), true)).toBe(1);
    });

    it("reads a lone position filling the LIMIT whole", () => {
      expect(within(sized(["a", 100], ["a", 100]), true)).toBe(2);
    });
  });
});

describe("streamSliceOrHalves", () => {
  const memoryLimit = () =>
    Object.assign(new Error("Memory limit (total) exceeded: would use 3.3 GiB"), { code: "241" });

  function slice(
    stream: (request: { params?: Record<string, unknown> }) => AsyncGenerator<ClickHouseEventRow[]>,
  ) {
    const applied: string[] = [];
    const client = clickHouseQueryClientDouble({
      stream: async function* (request) {
        yield* stream(request);
      },
    });
    const read = {
      client,
      tenantId: "project_a",
      aggregateIds: ["trace_1", "trace_2"],
      eventTypes: ["lw.span.received"],
      cutoffs: new Map(),
      lean: (event: ReplayEvent) => event,
      onEvent: (event: ReplayEvent) => {
        applied.push(event.id);
      },
    };
    return { read, applied };
  }

  describe("when the read hits a memory limit before it handed an event on", () => {
    /** @scenario "A slice over the server's memory before it applied an event is read as halves" */
    it("reads the slice again as two halves", async () => {
      const reads: string[][] = [];
      const { read, applied } = slice(async function* (request) {
        const ids = (request.params?.aggregateIds ?? []) as string[];
        reads.push(ids);
        if (ids.length > 1) throw memoryLimit();
        yield [row(`event_${ids[0]}`, 1)];
      });

      await expect(streamSliceOrHalves(read)).resolves.toBe(2);

      expect(reads).toEqual([["trace_1", "trace_2"], ["trace_1"], ["trace_2"]]);
      expect(applied).toEqual(["event_trace_1", "event_trace_2"]);
    });
  });

  describe("when the read hits a memory limit after it handed an event on", () => {
    /** @scenario "A slice over the server's memory after it applied an event fails without halving" */
    it("fails with that error and reads no half", async () => {
      const stream = vi.fn(async function* (): AsyncGenerator<ClickHouseEventRow[]> {
        yield [row("event_1", 1)];
        throw memoryLimit();
      });
      const { read, applied } = slice(stream);

      await expect(streamSliceOrHalves(read)).rejects.toMatchObject({ code: "241" });

      expect(stream).toHaveBeenCalledTimes(1);
      expect(applied).toEqual(["event_1"]);
    });
  });
});
