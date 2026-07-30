import {
  type ClickHouseClient,
  ch,
  createRowCodec,
  defineTable,
  replacing,
  type TableRow,
} from "@langwatch/clickhouse";
import { createLogger } from "@langwatch/observability";
import type {
  LangyAnalyticsEventRecord,
  LangyAnalyticsEventRepository,
} from "./langy-analytics-event.repository";

const logger = createLogger(
  "langwatch:app-layer:langy:analytics-event-repository",
);

/**
 * `langy_analytics_events` (migration 00047). `OccurredAt` anchors the
 * partition and TTL despite its name: unlike a trace's OccurredAt (customer
 * timing, movable), this table's `OccurredAt` is stamped once per `EventId`
 * and never revised — the migration's own comment establishes that — so it
 * carries the `acceptedAt` role here (ADR-099). The literal `AcceptedAt`
 * column is a separate timestamp the domain also carries and takes no role.
 */
const table = defineTable({
  name: "langy_analytics_events",
  merge: replacing({ version: "ProjectedAt" }),
  sortKey: ["TenantId", "OccurredAt", "EventId"],
  partition: { by: "toYearWeek(toDate(OccurredAt))", column: "OccurredAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "OccurredAt" },
  columns: {
    TenantId: ch.string(),
    EventId: ch.string(),
    EventType: ch.lowCardinality(ch.string()),
    EventVersion: ch.lowCardinality(ch.string()),
    AggregateId: ch.string(),
    TurnId: ch.nullable(ch.string()),
    UserId: ch.nullable(ch.string()),
    Role: ch.lowCardinality(ch.nullable(ch.string())),
    ToolName: ch.lowCardinality(ch.nullable(ch.string())),
    Outcome: ch.lowCardinality(ch.nullable(ch.string())),
    Model: ch.lowCardinality(ch.nullable(ch.string())),
    DurationMs: ch.nullable(ch.uint64()),
    OccurredAt: ch.acceptedAt(),
    AcceptedAt: ch.dateTime64(3),
    ProjectedAt: ch.writtenAt(),
    _retention_days: ch.uint16(),
  },
});

type Row = TableRow<typeof table.columns>;

const codec = createRowCodec();

/**
 * `writtenAt` is supplied by the caller rather than read from `Date.now()`
 * here, so one batch insert stamps every row with the same instant (the
 * table's `ProjectedAt DEFAULT now64(3)` used to give each row whatever the
 * server's clock read at merge time) and so this mapping stays a pure
 * function.
 */
function toRow(
  record: LangyAnalyticsEventRecord,
  retentionDays: number,
  writtenAt: Date,
): Row {
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
      record.durationMs === null ? null : BigInt(Math.round(record.durationMs)),
    OccurredAt: new Date(record.occurredAtMs),
    AcceptedAt: new Date(record.acceptedAtMs),
    ProjectedAt: writtenAt,
    _retention_days: retentionDays,
  };
}

function validateBatch(records: LangyAnalyticsEventRecord[]): string | null {
  const tenantId = records[0]?.tenantId;
  if (!tenantId) return null;

  for (const record of records) {
    if (!record.tenantId) {
      throw new Error(
        "ClickHouseLangyAnalyticsEventRepository requires a tenantId for tenant isolation",
      );
    }
    if (record.tenantId !== tenantId) {
      throw new Error("Langy analytics batch must contain exactly one tenant");
    }
  }
  return tenantId;
}

export class ClickHouseLangyAnalyticsEventRepository
  implements LangyAnalyticsEventRepository
{
  constructor(
    private readonly resolveClient: (tenantId: string) => ClickHouseClient,
  ) {}

  async insert(
    record: LangyAnalyticsEventRecord,
    retentionDays: number,
  ): Promise<void> {
    await this.insertRecords([record], retentionDays);
  }

  async insertBatch(
    records: LangyAnalyticsEventRecord[],
    retentionDays: number,
  ): Promise<void> {
    await this.insertRecords(records, retentionDays);
  }

  private async insertRecords(
    records: LangyAnalyticsEventRecord[],
    retentionDays: number,
  ): Promise<void> {
    const tenantId = validateBatch(records);
    if (tenantId === null) return;

    const writtenAt = new Date();
    const rows = records.map((record) =>
      toRow(record, retentionDays, writtenAt),
    );
    const encodedRows = codec.encodeRows({
      columns: table.wireColumns,
      columnNames: table.columnNames,
      rows,
    });

    try {
      const client = this.resolveClient(tenantId);
      await client.insert({
        tenantId,
        table: table.name,
        rows: encodedRows,
        columns: table.columnNames,
        // Retryable: ProjectedAt is the replacing version, so a redelivered
        // batch collapses at merge instead of duplicating (ADR-104 §2).
        target: { kind: "replacing" },
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
