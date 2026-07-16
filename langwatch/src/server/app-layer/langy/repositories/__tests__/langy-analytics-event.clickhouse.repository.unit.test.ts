import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";
import { ClickHouseLangyAnalyticsEventRepository } from "../langy-analytics-event.clickhouse.repository";
import type { LangyAnalyticsEventRecord } from "../langy-analytics-event.repository";

const record: LangyAnalyticsEventRecord = {
  tenantId: "project_1",
  eventId: "event_1",
  eventType: "lw.langy_conversation.agent_responded",
  eventVersion: "2026-07-10",
  aggregateId: "conversation_1",
  turnId: "turn_1",
  userId: null,
  role: "assistant",
  toolName: null,
  outcome: "completed",
  model: null,
  durationMs: 123,
  occurredAtMs: 1_000,
  acceptedAtMs: 1_100,
};

describe("ClickHouseLangyAnalyticsEventRepository", () => {
  it("writes one tenant-scoped event-grain row without reading first", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const resolveClient = vi
      .fn()
      .mockResolvedValue({ insert } as unknown as ClickHouseClient);
    const repository = new ClickHouseLangyAnalyticsEventRepository(
      resolveClient,
    );

    await repository.insert(record, 45);

    expect(resolveClient).toHaveBeenCalledWith("project_1");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      table: "langy_analytics_events",
      values: [
        {
          TenantId: "project_1",
          EventId: "event_1",
          EventType: "lw.langy_conversation.agent_responded",
          EventVersion: "2026-07-10",
          AggregateId: "conversation_1",
          TurnId: "turn_1",
          UserId: null,
          Role: "assistant",
          ToolName: null,
          Outcome: "completed",
          Model: null,
          DurationMs: "123",
          OccurredAt: new Date(1_000),
          AcceptedAt: new Date(1_100),
          _retention_days: 45,
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
    });
  });

  it("writes replay records as one acknowledged tenant batch", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const resolveClient = vi
      .fn()
      .mockResolvedValue({ insert } as unknown as ClickHouseClient);
    const repository = new ClickHouseLangyAnalyticsEventRepository(
      resolveClient,
    );

    await repository.insertBatch(
      [record, { ...record, eventId: "event_2", aggregateId: "conversation_2" }],
      90,
    );

    expect(resolveClient).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "langy_analytics_events",
        values: [
          expect.objectContaining({
            EventId: "event_1",
            AggregateId: "conversation_1",
            _retention_days: 90,
          }),
          expect.objectContaining({
            EventId: "event_2",
            AggregateId: "conversation_2",
            _retention_days: 90,
          }),
        ],
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      }),
    );
  });

  it("rejects a mixed-tenant batch before resolving a client", async () => {
    const resolveClient = vi.fn();
    const repository = new ClickHouseLangyAnalyticsEventRepository(
      resolveClient,
    );

    await expect(
      repository.insertBatch(
        [record, { ...record, tenantId: "project_2", eventId: "event_2" }],
        90,
      ),
    ).rejects.toThrow("Langy analytics batch must contain exactly one tenant");
    expect(resolveClient).not.toHaveBeenCalled();
  });

  it("does not resolve a client for an empty batch", async () => {
    const resolveClient = vi.fn();
    const repository = new ClickHouseLangyAnalyticsEventRepository(
      resolveClient,
    );

    await repository.insertBatch([], 90);

    expect(resolveClient).not.toHaveBeenCalled();
  });
});
