import type { ClickHouseClient } from "@langwatch/clickhouse";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const COLUMN_NAMES = [
  "TenantId",
  "EventId",
  "EventType",
  "EventVersion",
  "AggregateId",
  "TurnId",
  "UserId",
  "Role",
  "ToolName",
  "Outcome",
  "Model",
  "DurationMs",
  "OccurredAt",
  "AcceptedAt",
  "ProjectedAt",
  "_retention_days",
];

const rowFor = (
  overrides: Partial<{
    eventId: string;
    aggregateId: string;
    retentionDays: number;
  }>,
): unknown[] => [
  "project_1",
  overrides.eventId ?? "event_1",
  "lw.langy_conversation.agent_responded",
  "2026-07-10",
  overrides.aggregateId ?? "conversation_1",
  "turn_1",
  null,
  "assistant",
  null,
  "completed",
  null,
  "123",
  "1970-01-01 00:00:01.000",
  "1970-01-01 00:00:01.100",
  "2026-01-01 00:00:00.000",
  overrides.retentionDays ?? 45,
];

const setUp = () => {
  const insert = vi.fn().mockResolvedValue(undefined);
  const resolveClient = vi
    .fn()
    .mockReturnValue({ insert } as unknown as ClickHouseClient);
  const repository = new ClickHouseLangyAnalyticsEventRepository(resolveClient);
  return { repository, resolveClient, insert };
};

describe("ClickHouseLangyAnalyticsEventRepository", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes one tenant-scoped event-grain row through the positional codec", async () => {
    const { repository, resolveClient, insert } = setUp();

    await repository.insert(record, 45);

    expect(resolveClient).toHaveBeenCalledWith("project_1");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      tenantId: "project_1",
      table: "langy_analytics_events",
      rows: [rowFor({})],
      columns: COLUMN_NAMES,
      target: { kind: "replacing" },
    });
  });

  it("writes replay records as one acknowledged tenant batch", async () => {
    const { repository, resolveClient, insert } = setUp();

    await repository.insertBatch(
      [
        record,
        { ...record, eventId: "event_2", aggregateId: "conversation_2" },
      ],
      90,
    );

    expect(resolveClient).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith({
      tenantId: "project_1",
      table: "langy_analytics_events",
      rows: [
        rowFor({ retentionDays: 90 }),
        rowFor({
          eventId: "event_2",
          aggregateId: "conversation_2",
          retentionDays: 90,
        }),
      ],
      columns: COLUMN_NAMES,
      target: { kind: "replacing" },
    });
  });

  it("rejects a mixed-tenant batch before resolving a client", async () => {
    const { repository, resolveClient } = setUp();

    await expect(
      repository.insertBatch(
        [record, { ...record, tenantId: "project_2", eventId: "event_2" }],
        90,
      ),
    ).rejects.toThrow("Langy analytics batch must contain exactly one tenant");
    expect(resolveClient).not.toHaveBeenCalled();
  });

  it("does not resolve a client for an empty batch", async () => {
    const { repository, resolveClient } = setUp();

    await repository.insertBatch([], 90);

    expect(resolveClient).not.toHaveBeenCalled();
  });
});
