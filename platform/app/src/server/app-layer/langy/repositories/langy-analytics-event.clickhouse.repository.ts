import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import type {
  LangyAnalyticsEventRecord,
  LangyAnalyticsEventRepository,
} from "./langy-analytics-event.repository";

const TABLE_NAME = "langy_analytics_events" as const;
const logger = createLogger(
  "langwatch:app-layer:langy:analytics-event-repository",
);

interface ClickHouseLangyAnalyticsEventRecord {
  TenantId: string;
  EventId: string;
  EventType: string;
  EventVersion: string;
  AggregateId: string;
  TurnId: string | null;
  UserId: string | null;
  Role: string | null;
  ToolName: string | null;
  Outcome: string | null;
  Model: string | null;
  DurationMs: string | null;
  OccurredAt: Date;
  AcceptedAt: Date;
  _retention_days: number;
}

function toClickHouseRecord(
  record: LangyAnalyticsEventRecord,
  retentionDays: number,
): ClickHouseLangyAnalyticsEventRecord {
  return {
    TenantId: record.tenantId,
    EventId: record.eventId,
    EventType: record.eventType,
    EventVersion: record.eventVersion,
    AggregateId: record.aggregateId,
    TurnId: record.turnId,
    UserId: record.userId,
    Role: record.role,
    ToolName: record.toolName,
    Outcome: record.outcome,
    Model: record.model,
    DurationMs:
      record.durationMs === null ? null : String(Math.round(record.durationMs)),
    OccurredAt: new Date(record.occurredAtMs),
    AcceptedAt: new Date(record.acceptedAtMs),
    _retention_days: retentionDays,
  };
}

function validateBatch(records: LangyAnalyticsEventRecord[]): string | null {
  const tenantId = records[0]?.tenantId;
  if (!tenantId) return null;

  for (const record of records) {
    EventUtils.validateTenantId(
      { tenantId: record.tenantId },
      "ClickHouseLangyAnalyticsEventRepository.insert",
    );
    if (record.tenantId !== tenantId) {
      throw new Error("Langy analytics batch must contain exactly one tenant");
    }
  }
  return tenantId;
}

export class ClickHouseLangyAnalyticsEventRepository
  implements LangyAnalyticsEventRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insert(
    record: LangyAnalyticsEventRecord,
    retentionDays: number,
  ): Promise<void> {
    await this.insertRecords([record], retentionDays, false);
  }

  async insertBatch(
    records: LangyAnalyticsEventRecord[],
    retentionDays: number,
  ): Promise<void> {
    await this.insertRecords(records, retentionDays, true);
  }

  private async insertRecords(
    records: LangyAnalyticsEventRecord[],
    retentionDays: number,
    waitForInsert: boolean,
  ): Promise<void> {
    const tenantId = validateBatch(records);
    if (tenantId === null) return;

    try {
      const client = await this.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: records.map((record) =>
          toClickHouseRecord(record, retentionDays),
        ),
        format: "JSONEachRow",
        clickhouse_settings: {
          async_insert: 1,
          wait_for_async_insert: waitForInsert ? 1 : 0,
        },
      });
    } catch (error) {
      logger.error(
        {
          tenantId,
          eventCount: records.length,
          eventId: records.length === 1 ? records[0]?.eventId : undefined,
          eventType: records.length === 1 ? records[0]?.eventType : undefined,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert Langy analytics events",
      );
      throw error;
    }
  }
}
