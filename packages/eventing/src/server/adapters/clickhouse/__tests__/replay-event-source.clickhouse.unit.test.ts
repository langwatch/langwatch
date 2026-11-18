/** Spec: packages/eventing/specs/projection-replay.feature */
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

/** What the routed member receives for a built read or stream. */
type ReadRequest = Parameters<EventingClickHouseReplayClient["read"]>[0];

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

const SCOPED_TO_PROJECT_A = {
  identity: "reader",
  kind: "tenant",
  tenantId: "project_a",
  settings: expect.objectContaining({ SQL_langwatch_tenant_ids: "project_a" }),
};

/** The built statement of the read'th call the member received. */
const sentAt = (client: { read: ReturnType<typeof vi.fn> }, call: number) => {
  const [request] = client.read.mock.calls[call] ?? [];
  if (!request) throw new Error(`no read at call ${call}`);
  return request as {
    statement: { sql: string; params: Record<string, unknown>; identity: string; kind: string };
  };
};

/** One stored copy of an event: rows sharing a position are copies a merge has not collapsed. */
interface StoredCopy {
  copy: string;
  eventId: string;
  timestamp: number;
  payloadBytes: number;
}

const isAfter = (row: StoredCopy, at: { timestamp: number; eventId: string }) =>
  row.timestamp > at.timestamp || (row.timestamp === at.timestamp && row.eventId > at.eventId);

/** The value a built statement binds where its SQL reads `<pattern>{vN:Type}`. */
function boundAt(
  statement: { sql: string; params: Record<string, unknown> },
  pattern: string,
): unknown {
  const name = new RegExp(`${pattern} \\{(v\\d+):\\w+\\}`).exec(statement.sql)?.[1];
  return name === undefined ? undefined : statement.params[name];
}

/** event_log as ClickHouse answers the page's two reads: the WHERE's range, then any LIMIT. */
function eventLogOf(copies: readonly StoredCopy[]): EventingClickHouseReplayClient {
  const at = (timestamp: unknown, eventId: unknown) => ({
    timestamp: Number(timestamp),
    eventId: String(eventId),
  });
  const answer = ({ statement }: ReadRequest): unknown[] => {
    const upTo = at(boundAt(statement, "EventTimestamp <"), boundAt(statement, "EventId <="));
    const cursorId = boundAt(statement, "EventId >");
    const cursor = at(boundAt(statement, "EventTimestamp >"), cursorId);
    const range = copies.filter(
      (row) => !isAfter(row, upTo) && (cursorId === undefined || isAfter(row, cursor)),
    );
    const limit = /LIMIT (\d+)$/.exec(statement.sql)?.[1];
    const read = limit === undefined ? range : range.slice(0, Number(limit));
    if (!statement.sql.includes("AS payloadBytes")) {
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
    read: async <Row>(request: ReadRequest) => ({ rows: answer(request) as Row[] }),
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
    read: vi.fn().mockResolvedValue({ rows: [] }),
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
      expect(client.stream).toHaveBeenCalledWith({
        statement: expect.objectContaining(SCOPED_TO_PROJECT_A),
      });
      // Only the batch's sizes are read whole; its events arrive streamed.
      expect(client.read).toHaveBeenCalledTimes(1);
      expect(sentAt(client, 0).statement).toMatchObject(SCOPED_TO_PROJECT_A);
      expect(sentAt(client, 0).statement.sql).toContain("sum(length(EventPayload))");
    });

    /** @scenario "A replay batch reads its events streamed rather than held whole" */
    it("streams a built read of the batch's tenant, pruned by its occurred-at bounds", async () => {
      const { client, source } = member();
      client.stream.mockImplementation(async function* () {
        yield [row("event_1", 1)];
      });

      await source.streamEventsForAggregates({
        tenantId: "project_a",
        aggregateIds: ["trace_1"],
        eventTypes: ["lw.span.received"],
        cutoffs: new Map(),
        occurredAtBounds: { minMs: 5, maxMs: 9 },
        onEvent: () => undefined,
      });

      const [sent] = client.stream.mock.calls[0] ?? [];
      const { statement } = sent as { statement: { sql: string; params: object } };
      expect(statement).toMatchObject(SCOPED_TO_PROJECT_A);
      expect(statement.sql).toContain("FROM event_log WHERE TenantId = {tenantId:String}");
      expect(statement.sql).toMatch(/EventOccurredAt = \{v\d+:\w+\} OR/);
      expect(statement.sql).toMatch(/ORDER BY AggregateId ASC, EventTimestamp ASC, EventId ASC$/);
      expect(Object.values(statement.params)).toEqual(expect.arrayContaining([5, 9]));
    });
  });

  describe("when a replay is asked for every tenant", () => {
    /** @scenario "A replay across every tenant discovers on the shared server, as main did" */
    it("names no tenant and gives its reason, so the member reads the shared server", async () => {
      const { client, source } = member();

      await source.discoverAffectedAggregates({ eventTypes: ["lw.span.received"], sinceMs: 0 });

      // The member sends an all-tenants statement to the shared server on the system identity.
      expect(client.read).toHaveBeenCalledWith({
        statement: expect.objectContaining({
          identity: "system",
          kind: "allTenants",
          reason: expect.stringContaining("ops_projection_replay"),
        }),
        declaresFullScan: true,
      });
    });

    /** @scenario "A replay across every tenant discovers on the shared server, as main did" */
    it("names the tenant when the replay was asked for one", async () => {
      const { client, source } = member();

      await source.discoverAffectedAggregates({
        eventTypes: ["lw.span.received"],
        sinceMs: 0,
        tenantId: "project_a",
      });

      expect(client.read).toHaveBeenCalledWith(
        expect.objectContaining({ statement: expect.objectContaining(SCOPED_TO_PROJECT_A) }),
      );
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

      expect(client.read).toHaveBeenCalledWith({
        statement: expect.objectContaining(SCOPED_TO_PROJECT_A),
        declaresFullScan: true,
      });
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
      client.read
        .mockResolvedValueOnce({
          rows: [
            { EventTimestamp: "1", EventId: "event_1", payloadBytes: "600" },
            { EventTimestamp: "2", EventId: "event_2", payloadBytes: "600" },
          ],
        })
        .mockResolvedValueOnce({ rows: [row("event_1", 1)] });

      const events = await source.loadAggregateEvents(page);

      expect(events.map((event) => event.id)).toEqual(["event_1"]);
      const [sizes, read] = [sentAt(client, 0).statement, sentAt(client, 1).statement];
      expect(sizes.sql).not.toContain("EventPayload,");
      expect(boundAt(read, "EventTimestamp <")).toBe(1);
      expect(boundAt(read, "EventId <=")).toBe("event_1");
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

      expect(client.read).toHaveBeenCalledTimes(1);
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

  describe("given each read a replay batch makes of one tenant", () => {
    it("sends every one on the reader identity, scoped to that tenant alone", async () => {
      const { client, source } = member();
      client.read.mockResolvedValue({ rows: [{ cnt: 1, minOccurredAt: 5, maxOccurredAt: 9 }] });
      const batch = { tenantId: "project_a", eventTypes: ["lw.span.received"] };

      await source.countEventsForAggregates({ ...batch, sinceMs: 0 });
      await source.getBoundedCutoffs({ ...batch, aggregateTypes: ["trace"], aggregateIds: ["t1"] });
      await source.loadAggregateEvents({
        ...batch,
        aggregateIds: ["t1"],
        maxCutoff: { timestamp: 9, eventId: "e9" },
        cursor: { timestamp: 2, eventId: "e2" },
        batchSize: 100,
        occurredAtBounds: { minMs: 5, maxMs: 9 },
      });

      expect(client.read).toHaveBeenCalledTimes(4);
      for (let call = 0; call < 4; call++) {
        expect(sentAt(client, call).statement).toMatchObject(SCOPED_TO_PROJECT_A);
        expect(sentAt(client, call).statement.sql).toContain(
          "FROM event_log WHERE TenantId = {tenantId:String}",
        );
      }
      expect(sentAt(client, 0).statement.sql).toMatch(
        /^WITH discovered AS \(SELECT tuple\(AggregateType, AggregateId\) AS aggregateKey FROM event_log WHERE TenantId = \{tenantId:String\}/,
      );
      expect(sentAt(client, 0).statement.sql).toMatch(
        /tuple\(AggregateType, AggregateId\) IN discovered/,
      );
      expect(sentAt(client, 2).statement.sql).toContain(
        "argMax(EventId, tuple(EventTimestamp, EventId)) AS cutoffEventId",
      );
      expect(sentAt(client, 3).statement.sql).toMatch(
        /ORDER BY EventTimestamp ASC, EventId ASC LIMIT 100$/,
      );
    });
  });

  describe("given a replay listing or counting every tenant", () => {
    it("sends the tenant list and the count as all-tenants statements with their reason", async () => {
      const { client, source } = member();

      await source.discoverTenants({ eventTypes: ["lw.span.received"], sinceMs: 0 });
      await source.countEventsForAggregates({ eventTypes: ["lw.span.received"], sinceMs: 0 });

      for (let call = 0; call < 2; call++) {
        expect(sentAt(client, call).statement).toMatchObject({
          identity: "system",
          kind: "allTenants",
        });
        expect(sentAt(client, call).statement.sql).not.toContain("{tenantId:String}");
      }
      expect(sentAt(client, 0).statement.sql).toMatch(
        /^SELECT DISTINCT TenantId AS tenantId FROM event_log/,
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

  /** The batch's aggregate ids a built stream binds: the one array of trace ids. */
  const aggregateIdsOf = (request: ReadRequest) =>
    (Object.values(request.statement.params).find(
      (value) => Array.isArray(value) && String(value[0]).startsWith("trace_"),
    ) ?? []) as string[];

  function slice(stream: (request: ReadRequest) => AsyncGenerator<ClickHouseEventRow[]>) {
    const applied: string[] = [];
    const client = clickHouseQueryClientDouble({
      stream: async function* <Row>(request: ReadRequest) {
        yield* stream(request) as AsyncGenerator<Row[]>;
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
        const ids = aggregateIdsOf(request);
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
