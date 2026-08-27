import type { LangyAnalyticsEventRecord } from "@langwatch/langy-server";
import { describe, expect, it, vi } from "vitest";
import { AppLangyAnalyticsEventClickHouseAdapter } from "../langy-analytics-event.clickhouse.adapter";

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

describe("AppLangyAnalyticsEventClickHouseAdapter", () => {
  it("writes one tenant-scoped event without reading first", async () => {
    const insert = vi.fn().mockResolvedValue(void 0);
    const resolveClient = vi.fn().mockResolvedValue({ insert });
    const repository = new AppLangyAnalyticsEventClickHouseAdapter(resolveClient);

    await repository.insert(record, 45);

    expect(resolveClient).toHaveBeenCalledWith("project_1");
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

  it("writes replay records as one acknowledged batch", async () => {
    const insert = vi.fn().mockResolvedValue(void 0);
    const resolveClient = vi.fn().mockResolvedValue({ insert });
    const repository = new AppLangyAnalyticsEventClickHouseAdapter(resolveClient);

    await repository.insertBatch(
      [record, { ...record, eventId: "event_2", aggregateId: "conversation_2" }],
      90,
    );

    expect(resolveClient).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "langy_analytics_events",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      }),
    );
  });

  it("rejects mixed tenants before resolving a client", async () => {
    const resolveClient = vi.fn();
    const repository = new AppLangyAnalyticsEventClickHouseAdapter(resolveClient);

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
    const repository = new AppLangyAnalyticsEventClickHouseAdapter(resolveClient);

    await repository.insertBatch([], 90);

    expect(resolveClient).not.toHaveBeenCalled();
  });
});
