import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";
import {
  EVENT_LOG_SELECT_COLUMNS,
  EventRepositoryClickHouse,
} from "../eventRepositoryClickHouse";

/**
 * A client that answers with the stored row projected through the query's own
 * SELECT list, the way ClickHouse does. A mock that returns every column
 * whatever was asked for cannot fail when a read forgets to project one, which
 * is how `getEventRecords` shipped without `EventVersion`.
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

  return {
    query: vi.fn(async ({ query }: { query: string }) => {
      const selected = Object.keys(storedRow).filter((column) =>
        new RegExp(`\\b${column}\\b`).test(selectListOf(query)),
      );
      const projected = Object.fromEntries(
        selected.map((column) => [column, storedRow[column]]),
      );
      return { json: vi.fn().mockResolvedValue([projected]) };
    }),
  } as unknown as ClickHouseClient;
}

/** Everything between `SELECT` and the `FROM` that closes it. */
function selectListOf(query: string): string {
  return /SELECT([\s\S]*?)FROM/.exec(query)?.[1] ?? "";
}

/** The query text the repository sent on its Nth call. */
function queryOf({
  client,
  call = 0,
}: {
  client: ClickHouseClient;
  call?: number;
}): string {
  return (client.query as ReturnType<typeof vi.fn>).mock.calls[call]![0].query;
}

describe("EventRepositoryClickHouse.getEventRecords", () => {
  it("converts numeric strings inside parsed objects back to numbers", async () => {
    const client = createMockClient({
      data: {
        value: "42",
        nested: [{ count: "1", message: "keep-me" }],
      },
    });

    const repository = new EventRepositoryClickHouse(async () => client);
    const rows = await repository.getEventRecords("tenant", "agg", "id");

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

    const repository = new EventRepositoryClickHouse(async () => client);
    const rows = await repository.getEventRecords("tenant", "agg", "id");

    expect(rows[0]?.EventPayload).toEqual(
      '{"data":{"value":"123.45","text":"still-string"}}',
    );
  });

  describe("when an occurredAtFromMs lower bound is provided", () => {
    it("adds the EventOccurredAt partition-prune predicate and binds the param", async () => {
      const client = createMockClient({});
      const repository = new EventRepositoryClickHouse(async () => client);

      await repository.getEventRecords("tenant", "trace", "id", 1700000000000);

      const call = (client.query as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(call.query).toContain(
        "EventOccurredAt = 0 OR EventOccurredAt >= {occurredAtFromMs:UInt64}",
      );
      expect(call.query_params).toMatchObject({
        occurredAtFromMs: 1700000000000,
      });
    });
  });

  describe("when no usable lower bound is provided", () => {
    it("omits the EventOccurredAt predicate and the param", async () => {
      const client = createMockClient({});
      const repository = new EventRepositoryClickHouse(async () => client);

      await repository.getEventRecords("tenant", "trace", "id");

      const call = (client.query as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(call.query).not.toContain("EventOccurredAt >=");
      expect(call.query_params).not.toHaveProperty("occurredAtFromMs");
    });

    it("treats a zero lower bound as unbounded", async () => {
      const client = createMockClient({});
      const repository = new EventRepositoryClickHouse(async () => client);

      await repository.getEventRecords("tenant", "trace", "id", 0);

      const call = (client.query as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(call.query).not.toContain("EventOccurredAt >=");
      expect(call.query_params).not.toHaveProperty("occurredAtFromMs");
    });
  });
});

/**
 * The three reads answer the same record through the same mapping, so a
 * column one of them forgets to project decodes as `undefined` rather than
 * failing. `getEventRecords` shipped without `EventVersion` for exactly that
 * reason, and a version-gated fold reading a rehydrated event saw no version
 * at all.
 */
describe("EventRepositoryClickHouse read projections", () => {
  const upToRequest = {
    tenantId: "tenant",
    aggregateType: "trace",
    aggregateId: "id",
    upToTimestamp: 1700000000001,
    upToEventId: "evt",
  };

  describe("when any of the three reads runs", () => {
    it("projects every column the record mapper reads", async () => {
      const client = createMockClient({});
      const repository = new EventRepositoryClickHouse(async () => client);

      await repository.getEventRecords("tenant", "trace", "id");
      await repository.getEventRecordsUpTo(upToRequest);
      await repository.getEventRecordsUpToPaged({
        ...upToRequest,
        after: undefined,
        limit: 10,
      });

      for (let call = 0; call < 3; call++) {
        expect(queryOf({ client, call })).toContain(EVENT_LOG_SELECT_COLUMNS);
      }
    });
  });

  describe("when a stored event carries a version", () => {
    it("keeps the version on the record every read returns", async () => {
      const client = createMockClient({});
      const repository = new EventRepositoryClickHouse(async () => client);

      const [plain] = await repository.getEventRecords("tenant", "trace", "id");
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
