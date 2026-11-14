import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  type EventingClickHouseClient,
} from "@langwatch/eventing/server";
import { generate } from "@langwatch/ksuid";
import { describe, expect, it, vi } from "vitest";

import { EventNotFoundError } from "../../../../services/errorHandling.ts";
import { readEventRecord } from "../../../../stores/eventReadSeat.ts";
import { EVENT_LOG_SELECT_COLUMNS } from "../event-repository.clickhouse.ts";

const retention = createEventingRetentionConfiguration({ defaultRetentionDays: 49 });

type Read = EventingClickHouseClient["read"];
type ReadInput = Parameters<Read>[0];

function repositoryFor(client: EventingClickHouseClient): EventingClickHouseEventRepository {
  return EventingClickHouseEventRepository.create({
    resolveClient: async () => client,
    retention,
  });
}

/**
 * A client that answers with the stored row projected through the statement's own
 * SELECT list, the way ClickHouse does — a mock returning every column
 * regardless can't catch a read that forgets to project one.
 */
function createMockClient(payload: unknown) {
  const storedRow: Record<string, unknown> = {
    EventId: "evt",
    EventTimestamp: 1700000000000,
    EventOccurredAt: 1700000000000,
    EventType: "test.integration.event",
    EventPayload: payload,
    EventVersion: "2025-12-14",
    ProcessingTraceparent: "",
    IdempotencyKey: "",
  };

  const sent = vi.fn(({ statement }: ReadInput) => {
    const selected = Object.keys(storedRow).filter((column) =>
      new RegExp(`\\b${column}\\b`).test(selectListOf(statement.sql)),
    );
    return [Object.fromEntries(selected.map((column) => [column, storedRow[column]]))];
  });
  // Rows arrive untyped, as the driver's JSON does, until the caller names its row.
  const read: Read = async (input) => ({ rows: JSON.parse(JSON.stringify(sent(input))) });
  return { read, insert: vi.fn(), sent };
}

/** Everything between `SELECT` and the `FROM` that closes it. */
function selectListOf(query: string): string {
  return /SELECT([\s\S]*?)FROM/.exec(query)?.[1] ?? "";
}

/** The built read the repository sent on its Nth call. */
function sentOf({
  client,
  call = 0,
}: {
  client: ReturnType<typeof createMockClient>;
  call?: number;
}) {
  const sent = client.sent.mock.calls[call]?.[0];
  if (sent === undefined) throw new Error(`the repository sent no read ${call}`);
  return sent;
}

describe("EventRepositoryClickHouse.getEventRecords", () => {
  it("converts numeric strings inside parsed objects back to numbers", async () => {
    const client = createMockClient({
      data: {
        value: "42",
        nested: [{ count: "1", message: "keep-me" }],
      },
    });

    const repository = repositoryFor(client);
    const rows = await repository.getEventRecords({
      tenantId: "tenant",
      aggregateType: "agg",
      aggregateId: "id",
    });

    expect(rows[0]?.EventPayload).toEqual({
      data: {
        value: 42,
        nested: [{ count: 1, message: "keep-me" }],
      },
    });
  });

  it("does not parses JSON strings returned by ClickHouse", async () => {
    const client = createMockClient(
      JSON.stringify({
        data: { value: "123.45", text: "still-string" },
      }),
    );

    const repository = repositoryFor(client);
    const rows = await repository.getEventRecords({
      tenantId: "tenant",
      aggregateType: "agg",
      aggregateId: "id",
    });

    expect(rows[0]?.EventPayload).toEqual('{"data":{"value":"123.45","text":"still-string"}}');
  });

  describe("when an occurredAtFromMs lower bound is provided", () => {
    it("adds the EventOccurredAt partition-prune predicate and binds the param", async () => {
      const client = createMockClient({});
      const repository = repositoryFor(client);

      await repository.getEventRecords({
        tenantId: "tenant",
        aggregateType: "trace",
        aggregateId: "id",
        occurredAtFromMs: 1700000000000,
      });

      const { statement } = sentOf({ client });
      expect(statement.sql).toMatch(
        /\(EventOccurredAt = \{v\d+:UInt64\} OR EventOccurredAt >= \{v\d+:UInt64\}\)/,
      );
      expect(Object.values(statement.params)).toEqual(expect.arrayContaining([0, 1700000000000]));
    });
  });

  describe("when no usable lower bound is provided", () => {
    it("omits the EventOccurredAt predicate and the param", async () => {
      const client = createMockClient({});
      const repository = repositoryFor(client);

      await repository.getEventRecords({
        tenantId: "tenant",
        aggregateType: "trace",
        aggregateId: "id",
      });

      const { statement } = sentOf({ client });
      expect(statement.sql).not.toContain("EventOccurredAt >=");
      expect(Object.values(statement.params)).not.toContain(0);
    });

    it("treats a zero lower bound as unbounded", async () => {
      const client = createMockClient({});
      const repository = repositoryFor(client);

      await repository.getEventRecords({
        tenantId: "tenant",
        aggregateType: "trace",
        aggregateId: "id",
        occurredAtFromMs: 0,
      });

      const { statement } = sentOf({ client });
      expect(statement.sql).not.toContain("EventOccurredAt >=");
      expect(Object.values(statement.params)).not.toContain(0);
    });
  });
});

describe("EventRepositoryClickHouse.getEventRecord", () => {
  it("binds the tenant, aggregate and immutable event identity", async () => {
    const client = createMockClient({ value: "expected" });
    const repository = repositoryFor(client);

    await repository.getEventRecord({
      tenantId: "tenant-a",
      aggregateType: "trace",
      aggregateId: "trace-a",
      eventId: "event-a",
    });

    const { statement } = sentOf({ client });
    expect(statement.sql).toContain("FROM event_log WHERE TenantId = {tenantId:String}");
    expect(statement.sql).toMatch(/AggregateType = \{v\d+:String\}/);
    expect(statement.sql).toMatch(/AggregateId = \{v\d+:String\}/);
    expect(statement.sql).toMatch(/EventId = \{v\d+:String\}/);
    expect(statement.params).toMatchObject({ tenantId: "tenant-a" });
    expect(Object.values(statement.params)).toEqual(
      expect.arrayContaining(["trace", "trace-a", "event-a"]),
    );
  });
});

/**
 * The three reads answer the same record through the same mapping, so a
 * forgotten column decodes as `undefined` rather than failing —
 * `getEventRecords` shipped without `EventVersion` for exactly that reason.
 */
describe("EventRepositoryClickHouse read projections", () => {
  const upToRequest = {
    tenantId: "tenant",
    aggregateType: "trace",
    aggregateId: "id",
    upToTimestamp: 1700000000001,
    upToEventId: "evt",
  };

  describe("given the three reads that rehydrate an event record", () => {
    describe("when any of them runs", () => {
      it("projects every column the record mapper reads", async () => {
        const client = createMockClient({});
        const repository = repositoryFor(client);

        await repository.getEventRecords({
          tenantId: "tenant",
          aggregateType: "trace",
          aggregateId: "id",
        });
        await repository.getEventRecordsUpTo(upToRequest);
        await repository.getEventRecordsUpToPaged({
          ...upToRequest,
          after: undefined,
          limit: 10,
        });

        const columns = EVENT_LOG_SELECT_COLUMNS.split(",").map((column) => column.trim());
        for (let call = 0; call < 3; call++) {
          const selected = selectListOf(sentOf({ client, call }).statement.sql);
          for (const column of columns) expect(selected).toMatch(new RegExp(`\\b${column}\\b`));
        }
      });
    });

    describe("when a stored event carries a version", () => {
      it("keeps the version on the record every read returns", async () => {
        const client = createMockClient({});
        const repository = repositoryFor(client);

        const [plain] = await repository.getEventRecords({
          tenantId: "tenant",
          aggregateType: "trace",
          aggregateId: "id",
        });
        const [upTo] = await repository.getEventRecordsUpTo(upToRequest);
        const [paged] = await repository.getEventRecordsUpToPaged({
          ...upToRequest,
          after: undefined,
          limit: 10,
        });

        expect(plain?.EventVersion).toBe("2025-12-14");
        expect(upTo?.EventVersion).toBe("2025-12-14");
        expect(paged?.EventVersion).toBe("2025-12-14");
      });
    });
  });
});

describe("EventRepositoryClickHouse full-scan declarations", () => {
  const history = { tenantId: "tenant", aggregateType: "user", aggregateId: "id" };
  const upTo = { ...history, upToTimestamp: 1700000000001, upToEventId: "evt" };
  const declared = expect.objectContaining({ declaresFullScan: true });

  /** Runs the three aggregate-history reads, each with or without a lower bound. */
  async function readAllThree({ occurredAtFromMs }: { occurredAtFromMs?: number }) {
    const client = createMockClient({});
    const repository = repositoryFor(client);
    const bound = occurredAtFromMs === undefined ? {} : { occurredAtFromMs };
    await repository.getEventRecords({ ...history, ...bound });
    await repository.getEventRecordsUpTo({ ...upTo, ...bound });
    await repository.getEventRecordsUpToPaged({ ...upTo, ...bound, after: undefined, limit: 10 });
    return client.sent;
  }

  describe("given a long-lived aggregate read with no lower bound", () => {
    /** @scenario "An aggregate's unbounded history read is a declared full scan" */
    it("declares every history read a full scan", async () => {
      const query = await readAllThree({});
      for (const call of [1, 2, 3]) expect(query).toHaveBeenNthCalledWith(call, declared);
    });
  });

  describe("given a time-local aggregate read with a lower bound", () => {
    /** @scenario "An aggregate's unbounded history read is a declared full scan" */
    it("declares none of them, so the bound is what prunes", async () => {
      const query = await readAllThree({ occurredAtFromMs: 1700000000000 });
      expect(query).toHaveBeenCalledTimes(3);
      expect(query).not.toHaveBeenCalledWith(declared);
    });
  });
});

describe("EventRepositoryClickHouse over a ready event log index", () => {
  /** An index ready on every target, answering one range for every aggregate it is asked. */
  function indexedRepository({ rows }: { rows: unknown[] }) {
    const query = vi.fn((_input: ReadInput) => rows);
    const read: Read = async (input) => ({ rows: JSON.parse(JSON.stringify(query(input))) });
    const client: EventingClickHouseClient = { read, insert: vi.fn() };
    const indexBounds = vi.fn(async () => ({
      n: 1,
      fromMs: 1_600_000_000_000,
      toMs: 1_700_000_000_000,
    }));
    const repository = EventingClickHouseEventRepository.create({
      resolveClient: async () => client,
      retention,
      eventLogIndex: {
        reader: { targetOf: async () => "shared", indexBounds },
        readiness: { isReady: () => true },
      },
    });
    return { repository, query, indexBounds };
  }

  describe("given a read that names its own lower bound", () => {
    /** @scenario "a read that already has a lower bound skips the index" */
    it("reads with that bound and never asks the index", async () => {
      const { repository, query, indexBounds } = indexedRepository({ rows: [] });

      await repository.getEventRecords({
        tenantId: "tenant",
        aggregateType: "trace",
        aggregateId: "trace-1",
        occurredAtFromMs: 1_650_000_000_000,
      });

      expect(indexBounds).not.toHaveBeenCalled();
      expect(Object.values(query.mock.calls[0]?.[0].statement.params ?? {})).toContain(
        1_650_000_000_000,
      );
    });
  });

  describe("given an event the indexed stream does not hold", () => {
    /** @scenario "an event missing from its aggregate's indexed stream is read for once" */
    it("answers not found from one index read and one source read, with no fallback", async () => {
      const { repository, query, indexBounds } = indexedRepository({ rows: [] });

      await expect(
        readEventRecord({
          repository,
          tenantId: "tenant",
          aggregateType: "trace",
          aggregateId: "trace-1",
          eventId: generate("event").toString(),
        }),
      ).rejects.toBeInstanceOf(EventNotFoundError);

      expect(indexBounds).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledTimes(1);
    });
  });
});

describe("EventRepositoryClickHouse read scopes", () => {
  const key = { tenantId: "tenant-a", aggregateType: "trace", aggregateId: "trace-a" };
  const upTo = { ...key, upToTimestamp: 1700000000001, upToEventId: "evt" };

  describe("given each read of one aggregate", () => {
    it("sends a built statement on the reader identity, scoped to that tenant alone", async () => {
      const client = createMockClient({});
      const repository = repositoryFor(client);

      await repository.getEventRecord({ ...key, eventId: "evt" });
      await repository.getEventRecords(key);
      await repository.getEventRecordsUpTo(upTo);
      await repository.getEventRecordsUpToPaged({ ...upTo, after: undefined, limit: 10 });
      await repository.countEventRecords({ ...key, beforeTimestamp: 1, beforeEventId: "evt" });

      expect(client.sent).toHaveBeenCalledTimes(5);
      for (let call = 0; call < 5; call++) {
        const { statement } = sentOf({ client, call });
        expect(statement).toMatchObject({
          identity: "reader",
          kind: "tenant",
          tenantId: "tenant-a",
          settings: { SQL_langwatch_tenant_ids: "tenant-a" },
        });
        expect(statement.sql).toContain("FROM event_log WHERE TenantId = {tenantId:String}");
      }
    });
  });
});
