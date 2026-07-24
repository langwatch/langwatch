import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";
import { EventRepositoryClickHouse } from "../eventRepositoryClickHouse";

function createMockClient(payload: unknown) {
  return {
    query: vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue([
        {
          EventId: "evt",
          EventTimestamp: 1700000000000,
          EventOccurredAt: 1700000000000,
          EventType: "test.integration.event",
          EventPayload: payload,
          ProcessingTraceparent: "",
          IdempotencyKey: "",
        },
      ]),
    }),
  } as unknown as ClickHouseClient;
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
