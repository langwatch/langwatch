import { z } from "zod";
import { EventUtils } from "@langwatch/eventing";
import type { CanonicalLogRecord, CanonicalTraceLogRecord } from "@langwatch/log-contract";
import { createLogger } from "@langwatch/observability";
import { CanonicalLogRecordRepository } from "../canonical-log-record.repository";
import {
  ClickHouseCanonicalLogRecordAppendRepository,
  type LogClickHouseClientResolver,
} from "./clickhouse.canonical-log-record-append.repository";

const logger = createLogger("langwatch:log:canonical-log-record-repository");

const traceLogRowSchema = z.object({
  TraceId: z.string(),
  SpanId: z.string(),
  TimeUnixMs: z.union([z.number(), z.string()]),
  BodyText: z.string().nullable(),
  AttributesFlatJson: z.string(),
  ResourceAttributesFlatJson: z.string(),
  ScopeName: z.string(),
  ScopeVersion: z.string(),
  EventName: z.string(),
});

/**
 * The whole canonical-log surface over ClickHouse: the append half, and the
 * trace-scoped read only a query graph makes.
 *
 * The appends are delegated rather than reimplemented. There is one insert
 * path in this package, and a graph that consumes `log_processing` composes
 * the same {@link ClickHouseCanonicalLogRecordAppendRepository} this class
 * holds — so the two graphs cannot come to disagree about what an append does.
 */
export class ClickHouseCanonicalLogRecordRepository extends CanonicalLogRecordRepository {
  private readonly append: ClickHouseCanonicalLogRecordAppendRepository;

  private constructor(
    private readonly resolveClient: LogClickHouseClientResolver,
    defaultRetentionDays: number,
    private readonly defaultReadLimit: number,
  ) {
    super();
    this.append = ClickHouseCanonicalLogRecordAppendRepository.create({
      resolveClient,
      defaultRetentionDays,
    });
  }

  static create(options: {
    resolveClient: LogClickHouseClientResolver;
    defaultRetentionDays: number;
    defaultReadLimit: number;
  }): ClickHouseCanonicalLogRecordRepository {
    return new ClickHouseCanonicalLogRecordRepository(
      options.resolveClient,
      options.defaultRetentionDays,
      options.defaultReadLimit,
    );
  }

  async ensureLogRecord(record: CanonicalLogRecord, retentionDays?: number): Promise<void> {
    await this.append.ensureLogRecord(record, retentionDays);
  }

  async ensureLogRecords(records: CanonicalLogRecord[], retentionDays?: number): Promise<void> {
    await this.append.ensureLogRecords(records, retentionDays);
  }

  async getLogsByTraceId({
    tenantId,
    traceId,
    occurredAtMs,
    limit = this.defaultReadLimit,
  }: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<CanonicalTraceLogRecord[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "ClickHouseCanonicalLogRecordRepository.getLogsByTraceId",
    );
    const center = typeof occurredAtMs === "number" && occurredAtMs > 0 ? occurredAtMs : Date.now();
    const from = new Date(center - 14 * 24 * 60 * 60 * 1000);
    const to = new Date(center + 2 * 24 * 60 * 60 * 1000);
    const client = await this.resolveClient(tenantId);
    const result = await client.query({
      query: `
        SELECT
          CorrelationTraceId AS TraceId,
          CorrelationSpanId AS SpanId,
          toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs,
          BodyText,
          AttributesFlatJson,
          ResourceAttributesFlatJson,
          ScopeName,
          ScopeVersion,
          EventName
        FROM log_records FINAL
        WHERE TenantId = {tenantId:String}
          AND CorrelationTraceId = {traceId:String}
          AND log_records.TimeUnixMs >= {from:DateTime64(3)}
          AND log_records.TimeUnixMs <= {to:DateTime64(3)}
        ORDER BY TimeUnixNano ASC, RecordId ASC
        LIMIT {limit:UInt64}
      `,
      query_params: { tenantId, traceId, from, to, limit },
      format: "JSONEachRow",
    });
    const rows = z.array(traceLogRowSchema).parse(await result.json());
    if (rows.length >= limit) {
      logger.warn({ tenantId, traceId, limit }, "Canonical trace log read hit its row cap");
    }
    return rows.map((row) => {
      const attributes = z.record(z.string(), z.string()).parse(JSON.parse(row.AttributesFlatJson));
      if (row.EventName && attributes["event.name"] === undefined) {
        attributes["event.name"] = row.EventName;
      }
      return {
        traceId: row.TraceId,
        spanId: row.SpanId,
        timeUnixMs: Number(row.TimeUnixMs),
        body: row.BodyText ?? "",
        attributes,
        resourceAttributes: z
          .record(z.string(), z.string())
          .parse(JSON.parse(row.ResourceAttributesFlatJson)),
        scopeName: row.ScopeName,
        scopeVersion: row.ScopeVersion || null,
      };
    });
  }
}
