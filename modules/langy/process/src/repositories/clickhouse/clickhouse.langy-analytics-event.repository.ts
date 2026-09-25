import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { Temporal, toDate } from "@langwatch/time";

import {
  LangyAnalyticsEventRepository,
  type LangyAnalyticsEventRecord,
} from "../langy-analytics-event.repository.ts";

/**
 * The `DateTime64(3)` columns. The ClickHouse client serialises a `Date`; an
 * instant serialises to `{}`, so the conversion happens here and nowhere above.
 */
type ClickHouseDateTime = ReturnType<typeof toDate>;

/**
 * The one ClickHouse operation this sink performs, named structurally. A
 * feature package may not import a vendor SDK: the real `ClickHouseClient`,
 * the Eventing substrate's client and a fake all satisfy this instead.
 */
export interface LangyAnalyticsClickHouseWriteClient {
  insert(input: {
    table: string;
    values: readonly unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown>;
}

export type LangyAnalyticsClickHouseClientResolver = (
  tenantId: string,
) => Promise<LangyAnalyticsClickHouseWriteClient>;

type ClickHouseLangyAnalyticsEventRecord = {
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
  OccurredAt: ClickHouseDateTime;
  AcceptedAt: ClickHouseDateTime;
  _retention_days: number;
};

const tableName = "langy_analytics_events";
const logger = createLogger("langwatch:langy:analytics-event-repository");

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
    DurationMs: record.durationMs === null ? null : String(Math.round(record.durationMs)),
    OccurredAt: toDate(Temporal.Instant.fromEpochMilliseconds(record.occurredAtMs)),
    AcceptedAt: toDate(Temporal.Instant.fromEpochMilliseconds(record.acceptedAtMs)),
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

/** Event-grain Langy analytics to ClickHouse. Wire format (table name, columns, async settings,
 * one-tenant guard) is literal in tests, not schema-derived. `wait_for_async_insert` differs
 * between entry points: single appends (projection writes) vs batches (bulk flushes). */
export class LangyAnalyticsEventClickHouseRepository extends LangyAnalyticsEventRepository {
  static create(
    resolveClient: LangyAnalyticsClickHouseClientResolver,
  ): LangyAnalyticsEventClickHouseRepository {
    return new LangyAnalyticsEventClickHouseRepository(resolveClient);
  }

  constructor(private readonly resolveClient: LangyAnalyticsClickHouseClientResolver) {
    super();
  }

  async insert(record: LangyAnalyticsEventRecord, retentionDays: number): Promise<void> {
    await this.insertRecords([record], retentionDays, false);
  }

  async insertBatch(records: LangyAnalyticsEventRecord[], retentionDays: number): Promise<void> {
    await this.insertRecords(records, retentionDays, true);
  }

  private async insertRecords(
    records: LangyAnalyticsEventRecord[],
    retentionDays: number,
    waitForInsert: boolean,
  ): Promise<void> {
    const tenantId = validateBatch(records);
    if (!tenantId) return;

    try {
      const client = await this.resolveClient(tenantId);
      await client.insert({
        table: tableName,
        values: records.map((record) => toClickHouseRecord(record, retentionDays)),
        format: "JSONEachRow",
        clickhouse_settings: {
          async_insert: 1,
          wait_for_async_insert: waitForInsert ? 1 : 0,
        },
      });
    } catch (error) {
      logger.warn(
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
