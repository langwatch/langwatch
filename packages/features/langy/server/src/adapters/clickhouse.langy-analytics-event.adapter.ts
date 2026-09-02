import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  LangyAnalyticsEventSinkPort,
  type LangyAnalyticsEventRecord,
} from "../ports/langy-analytics-event-sink.port";

/**
 * The one ClickHouse operation this sink performs, named structurally.
 *
 * A feature package may not import a vendor SDK, and it does not need to: the
 * real `ClickHouseClient`, the Eventing substrate's narrowed client and a fake
 * all satisfy this, which is what lets the twin test read the exact bytes that
 * would have gone on the wire.
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
  OccurredAt: Date;
  AcceptedAt: Date;
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

/**
 * Content-free, event-grain Langy analytics, written to ClickHouse.
 *
 * The table name, the column spelling, the async-insert settings and the
 * one-tenant-per-batch guard are a WIRE FORMAT with a table nothing here
 * compiles against: a column written under another name is accepted by
 * ClickHouse and fills the real one with its default, and no reader can tell a
 * defaulted value from a written one. They are pinned by literal in this
 * adapter's own test rather than derived from a schema only one side reads.
 *
 * `wait_for_async_insert` differs between the two entry points on purpose: a
 * single append is a projection write whose caller is holding a fold open, and
 * a batch is a bulk flush the runtime already sequences.
 */
export class ClickHouseLangyAnalyticsEventAdapter extends LangyAnalyticsEventSinkPort {
  static create(
    resolveClient: LangyAnalyticsClickHouseClientResolver,
  ): ClickHouseLangyAnalyticsEventAdapter {
    return new ClickHouseLangyAnalyticsEventAdapter(resolveClient);
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
