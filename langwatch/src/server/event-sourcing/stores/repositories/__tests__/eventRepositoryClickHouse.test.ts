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

    const repository = new EventRepositoryClickHouse(client);
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

    const repository = new EventRepositoryClickHouse(client);
    const rows = await repository.getEventRecords("tenant", "agg", "id");

    expect(rows[0]?.EventPayload).toEqual(
      '{"data":{"value":"123.45","text":"still-string"}}',
    );
  });
});
