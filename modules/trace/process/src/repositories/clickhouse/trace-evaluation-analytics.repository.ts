import type { Authorization } from "@langwatch/authorization";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type {
  LiveTraceEvaluationAnalyticsRow,
  TraceEvaluationAnalyticsWrite,
} from "../../rules/trace-evaluation-analytics.rules.ts";
import { TraceEvaluationAnalyticsRepository } from "../trace-evaluation-analytics.repository.ts";
import { traceEvaluationAnalytics as evaluations } from "./clickhouse.trace-evaluation-analytics.table.ts";
import type { TraceClickHouseWriteResolver } from "./clickhouse.trace-member-client.repository.ts";

const TABLE_NAME = "trace_evaluation_analytics" as const;

const logger = createLogger("langwatch:trace:trace-evaluation-analytics-repository");

/** Every physical column but Sign: the live read groups by all of them. */
const ROW_COLUMNS = [
  evaluations.TenantId,
  evaluations.TraceId,
  evaluations.EvaluationId,
  evaluations.OccurredAt,
  evaluations.UpdatedAt,
  evaluations.TraceOccurredAt,
  evaluations.EvaluatorName,
  evaluations.Status,
  evaluations.IsGuardrail,
  evaluations.Passed,
  evaluations.Label,
  evaluations.Origin,
  evaluations.TraceOrigin,
  evaluations.CustomerId,
  evaluations.TopicId,
  evaluations.Labels,
  evaluations.MetadataTopic,
  evaluations.MetadataDocumentType,
  evaluations.MetadataLanguage,
  evaluations.MetadataTeam,
  evaluations.MetadataFlow,
  evaluations.MetadataSegment,
  evaluations.MetadataPromptVersion,
  evaluations.Revision,
  evaluations._retention_days,
];

/** What the fold reads back: every grouped column, times as epoch millis, the summed sign. */
const LIVE_SELECTION = {
  TenantId: evaluations.TenantId,
  TraceId: evaluations.TraceId,
  EvaluationId: evaluations.EvaluationId,
  OccurredAtMs: fn.toUnixTimestamp64Milli(evaluations.OccurredAt),
  UpdatedAtMs: fn.toUnixTimestamp64Milli(evaluations.UpdatedAt),
  TraceOccurredAtMs: fn.toUnixTimestamp64Milli(evaluations.TraceOccurredAt),
  EvaluatorName: evaluations.EvaluatorName,
  Status: evaluations.Status,
  IsGuardrail: evaluations.IsGuardrail,
  Passed: evaluations.Passed,
  Label: evaluations.Label,
  Origin: evaluations.Origin,
  TraceOrigin: evaluations.TraceOrigin,
  CustomerId: evaluations.CustomerId,
  TopicId: evaluations.TopicId,
  Labels: evaluations.Labels,
  MetadataTopic: evaluations.MetadataTopic,
  MetadataDocumentType: evaluations.MetadataDocumentType,
  MetadataLanguage: evaluations.MetadataLanguage,
  MetadataTeam: evaluations.MetadataTeam,
  MetadataFlow: evaluations.MetadataFlow,
  MetadataSegment: evaluations.MetadataSegment,
  MetadataPromptVersion: evaluations.MetadataPromptVersion,
  Revision: evaluations.Revision,
  _retention_days: evaluations._retention_days,
  SignSum: fn.sum(evaluations.Sign),
};

/*
 * The fold reads its last write back to diff (trace ADR-003). Sequential reads see every quorum
 * write but need insert_quorum_parallel=0, which on ClickHouse 26.8 rejects an INSERT until the
 * previous quorum insert finishes; async quorum inserts need =1, hence synchronous inserts.
 */
const READ_YOUR_WRITES_INSERT = {
  async_insert: 0,
  insert_quorum: "auto",
  insert_quorum_parallel: 0,
};
const READ_YOUR_WRITES_QUERY = { select_sequential_consistency: 1 };
const ASYNC_INSERT = { async_insert: 1, wait_for_async_insert: 1 };

const nullableString = z.string().nullable();
const flag = z.union([z.boolean(), z.number(), z.string()]).transform(isSet);
const integer = z.union([z.number(), z.string()]).transform(Number);

const liveRecordSchema = z.object({
  TenantId: z.string(),
  TraceId: z.string(),
  EvaluationId: z.string(),
  OccurredAtMs: integer,
  UpdatedAtMs: integer,
  TraceOccurredAtMs: integer,
  EvaluatorName: nullableString,
  Status: z.string(),
  IsGuardrail: flag,
  Passed: z.union([z.boolean(), z.number(), z.string()]).nullable(),
  Label: nullableString,
  Origin: nullableString,
  TraceOrigin: nullableString,
  CustomerId: nullableString,
  TopicId: nullableString,
  Labels: z.array(z.string()),
  MetadataTopic: z.string(),
  MetadataDocumentType: z.string(),
  MetadataLanguage: z.string(),
  MetadataTeam: z.string(),
  MetadataFlow: z.string(),
  MetadataSegment: z.string(),
  MetadataPromptVersion: z.string(),
  Revision: integer,
  _retention_days: integer,
  SignSum: integer,
});

const liveRecordsSchema = z.array(liveRecordSchema);

/** The write shape; `Revision` (UInt64) rides as a string for JSON precision. */
type ClickHouseTraceEvaluationAnalyticsRecord = {
  TenantId: string;
  TraceId: string;
  EvaluationId: string;
  OccurredAt: Date;
  UpdatedAt: Date;
  TraceOccurredAt: Date;
  EvaluatorName: string | null;
  Status: string;
  IsGuardrail: boolean;
  Passed: boolean | null;
  Label: string | null;
  Origin: string | null;
  TraceOrigin: string | null;
  CustomerId: string | null;
  TopicId: string | null;
  Labels: string[];
  MetadataTopic: string;
  MetadataDocumentType: string;
  MetadataLanguage: string;
  MetadataTeam: string;
  MetadataFlow: string;
  MetadataSegment: string;
  MetadataPromptVersion: string;
  Sign: number;
  Revision: string;
  _retention_days: number;
};

function isSet(value: boolean | number | string): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function toRecord(write: TraceEvaluationAnalyticsWrite): ClickHouseTraceEvaluationAnalyticsRecord {
  const { row } = write;
  return {
    TenantId: row.tenantId,
    TraceId: row.traceId,
    EvaluationId: row.evaluationId,
    OccurredAt: new Date(row.occurredAtMs),
    UpdatedAt: new Date(write.updatedAtMs),
    TraceOccurredAt: new Date(row.traceOccurredAtMs),
    EvaluatorName: row.evaluatorName,
    Status: row.status,
    IsGuardrail: row.isGuardrail,
    Passed: row.passed,
    Label: row.label,
    Origin: row.origin,
    TraceOrigin: row.traceOrigin,
    CustomerId: row.customerId,
    TopicId: row.topicId,
    Labels: [...row.labels],
    MetadataTopic: row.metadataTopic,
    MetadataDocumentType: row.metadataDocumentType,
    MetadataLanguage: row.metadataLanguage,
    MetadataTeam: row.metadataTeam,
    MetadataFlow: row.metadataFlow,
    MetadataSegment: row.metadataSegment,
    MetadataPromptVersion: row.metadataPromptVersion,
    Sign: write.sign,
    Revision: String(write.revision),
    _retention_days: write.retentionDays,
  };
}

function fromRecord(record: z.infer<typeof liveRecordSchema>): LiveTraceEvaluationAnalyticsRow {
  return {
    row: {
      tenantId: record.TenantId,
      traceId: record.TraceId,
      evaluationId: record.EvaluationId,
      occurredAtMs: record.OccurredAtMs,
      traceOccurredAtMs: record.TraceOccurredAtMs,
      evaluatorName: record.EvaluatorName,
      status: record.Status,
      isGuardrail: record.IsGuardrail,
      passed: record.Passed === null ? null : isSet(record.Passed),
      label: record.Label,
      origin: record.Origin,
      traceOrigin: record.TraceOrigin,
      customerId: record.CustomerId,
      topicId: record.TopicId,
      labels: record.Labels,
      metadataTopic: record.MetadataTopic,
      metadataDocumentType: record.MetadataDocumentType,
      metadataLanguage: record.MetadataLanguage,
      metadataTeam: record.MetadataTeam,
      metadataFlow: record.MetadataFlow,
      metadataSegment: record.MetadataSegment,
      metadataPromptVersion: record.MetadataPromptVersion,
    },
    updatedAtMs: record.UpdatedAtMs,
    revision: record.Revision,
    retentionDays: record._retention_days,
    signSum: record.SignSum,
  };
}

/**
 * Writes the tenant's own ClickHouse; reads go through the proof's fence (ADR-177).
 * `readYourWrites` (default off) writes by quorum and reads sequentially consistent.
 */
export class TraceEvaluationAnalyticsClickHouseRepository extends TraceEvaluationAnalyticsRepository {
  private constructor(
    private readonly options: {
      resolveClient: TraceClickHouseWriteResolver;
      reader: Pick<ClickHouseQueryClient, "read">;
      readYourWrites: boolean;
    },
  ) {
    super();
  }

  static create({
    resolveClient,
    reader,
    readYourWrites = false,
  }: {
    resolveClient: TraceClickHouseWriteResolver;
    reader: Pick<ClickHouseQueryClient, "read">;
    readYourWrites?: boolean;
  }): TraceEvaluationAnalyticsClickHouseRepository {
    return new TraceEvaluationAnalyticsClickHouseRepository({
      resolveClient,
      reader,
      readYourWrites,
    });
  }

  async insertRows({
    writes,
  }: {
    writes: readonly TraceEvaluationAnalyticsWrite[];
  }): Promise<void> {
    const [first] = writes;
    if (!first) return;
    const tenantId = first.row.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "TraceEvaluationAnalyticsClickHouseRepository.insertRows",
    );
    // One client per tenant: a mixed batch would route one tenant's rows through another's.
    for (const { row } of writes) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError({
          operation: "TraceEvaluationAnalyticsClickHouseRepository.insertRows",
          message: "all rows in a single batch must share the same tenantId",
          tenantId,
          context: { mismatchedTenantId: row.tenantId },
        });
      }
    }
    try {
      const client = await this.options.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: writes.map(toRecord),
        format: "JSONEachRow",
        clickhouse_settings: this.options.readYourWrites ? READ_YOUR_WRITES_INSERT : ASYNC_INSERT,
      });
    } catch (error) {
      logger.warn(
        {
          tenantId,
          count: writes.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert trace_evaluation_analytics rows into ClickHouse",
      );
      throw error;
    }
  }

  async findLiveRows({
    authorization,
    traceIds,
    occurredAtFromMs,
  }: {
    authorization: Authorization;
    traceIds: readonly string[];
    occurredAtFromMs: number;
  }): Promise<LiveTraceEvaluationAnalyticsRow[]> {
    if (traceIds.length === 0) return [];
    // Grouped by every column, so a row and its retraction cancel exactly. A negative group comes
    // back too, so the fold's next revision skips its number (trace ADR-003).
    const live = clickhouseRead({
      scope: tenantScope.fromProof({ authorization, reads: "traces" }),
    })
      .from(evaluations)
      .withinWindows()
      .select(LIVE_SELECTION)
      .where(({ and, gte, oneOf }) =>
        and(oneOf(evaluations.TraceId, traceIds), gte(evaluations.OccurredAt, occurredAtFromMs)),
      )
      .groupBy(...ROW_COLUMNS)
      .having(({ ne }) => ne(fn.sum(evaluations.Sign), 0));
    const statement = (
      this.options.readYourWrites ? live.settings(READ_YOUR_WRITES_QUERY) : live
    ).build();
    const result = await this.options.reader.read({ statement, table: TABLE_NAME });
    return liveRecordsSchema.parse(result.rows).map(fromRecord);
  }
}
