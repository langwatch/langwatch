import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import {
  asNullableNumber,
  asNullableString,
  asNumber,
  asStringArray,
  asStringMap,
} from "~/server/clickhouse/recordDecode";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { EvaluationAnalyticsRow } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalytics.foldProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import type { EvaluationAnalyticsRepository } from "./evaluation-analytics.repository";

const TABLE_NAME = "evaluation_analytics" as const;

const logger = createLogger(
  "langwatch:app-layer:evaluations:evaluation-analytics-repository",
);

/**
 * ClickHouse write shape for the slim `evaluation_analytics` table
 * (ADR-034 Phase 6, migration 00041; read-back columns migration 00056).
 *
 * The 64-bit-integer columns (`DurationMs`, and the epoch-ms read-back
 * timestamps) are serialised as STRINGS in the JSONEachRow body — JSON numbers
 * can't safely round-trip values past 2^53, and the exact ms is compared
 * numerically on read-back. Float64 / UInt32 / Bool columns stay as numbers /
 * booleans.
 */
interface ClickHouseEvaluationAnalyticsWriteRecord {
  TenantId: string;
  EvaluationId: string;
  Version: string;
  OccurredAt: Date;
  CreatedAt: Date;
  UpdatedAt: Date;

  EvaluatorType: string;
  EvaluatorName: string | null;
  Status: string;
  IsGuardrail: boolean;
  Passed: boolean | null;
  Score: number | null;
  Label: string | null;
  Model: string | null;
  TraceId: string | null;
  UserId: string | null;
  ConversationId: string | null;
  CustomerId: string | null;
  Origin: string | null;

  // Int64 column — stringified for JSON precision.
  DurationMs: string;
  TotalCost: number | null;
  NonBilledCost: number | null;

  Attributes: Record<string, string>;

  // ── Read-back state (ADR-066, migration 00056) ─────────────────────────
  // Epoch ms as strings; "0" = null (not started / not completed).
  StartedAt: string;
  CompletedAt: string;

  // ── Durable dedup watermark (ADR-066, migration 00056) ─────────────────
  AppliedEventIds: string[];

  _retention_days: number;
}

/** UInt64 epoch-ms columns ride as strings; 0/null both serialise to "0". */
const bigMs = (n: number | null): string =>
  n !== null && n > 0 ? String(Math.round(n)) : "0";

function toClickHouseRecord(
  row: EvaluationAnalyticsRow,
  retentionDays: number,
  appliedEventIds: readonly string[] = [],
): ClickHouseEvaluationAnalyticsWriteRecord {
  return {
    TenantId: row.tenantId,
    EvaluationId: row.evaluationId,
    Version: row.version,
    OccurredAt: new Date(row.occurredAtMs),
    CreatedAt: new Date(row.createdAtMs),
    UpdatedAt: new Date(row.updatedAtMs),

    EvaluatorType: row.evaluatorType,
    EvaluatorName: row.evaluatorName,
    Status: row.status,
    IsGuardrail: row.isGuardrail,
    Passed: row.passed,
    Score: row.score,
    Label: row.label,
    Model: row.model,
    TraceId: row.traceId,
    UserId: row.userId,
    ConversationId: row.conversationId,
    CustomerId: row.customerId,
    Origin: row.origin,

    DurationMs: String(Math.round(row.durationMs)),
    TotalCost: row.totalCost,
    NonBilledCost: row.nonBilledCost,

    Attributes: row.attributes,

    StartedAt: bigMs(row.startedAtMs),
    CompletedAt: bigMs(row.completedAtMs),

    AppliedEventIds: [...appliedEventIds],

    _retention_days: retentionDays,
  };
}

export class EvaluationAnalyticsClickHouseRepository
  implements EvaluationAnalyticsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async upsert(
    row: EvaluationAnalyticsRow,
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
    appliedEventIds?: readonly string[],
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "EvaluationAnalyticsClickHouseRepository.upsert",
    );

    try {
      const client = await this.resolveClient(row.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [toClickHouseRecord(row, retentionDays, appliedEventIds)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      logger.error(
        {
          tenantId: row.tenantId,
          evaluationId: row.evaluationId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to upsert evaluation_analytics row into ClickHouse",
      );
      throw error;
    }
  }

  async upsertBatch(
    entries: Array<{
      row: EvaluationAnalyticsRow;
      retentionDays?: number;
      appliedEventIds?: readonly string[];
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = entries[0]!.row.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "EvaluationAnalyticsClickHouseRepository.upsertBatch",
    );
    for (const { row } of entries) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "EvaluationAnalyticsClickHouseRepository.upsertBatch",
          "all rows in a single batch must share the same tenantId",
          tenantId,
          { mismatchedTenantId: row.tenantId },
        );
      }
    }

    try {
      const client = await this.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: entries.map(({ row, retentionDays, appliedEventIds }) =>
          toClickHouseRecord(
            row,
            retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
            appliedEventIds,
          ),
        ),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          tenantId,
          count: entries.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to batch upsert evaluation_analytics rows into ClickHouse",
      );
      throw error;
    }
  }

  /**
   * The evaluation's last committed slim row plus its applied-event-id
   * watermark (ADR-066, migration 00056) — the CH-fallthrough behind a Redis
   * cache miss.
   *
   * Dedups with the IN-tuple pattern (max(UpdatedAt) per key), never FINAL: the
   * ReplacingMergeTree only physically collapses rows sharing the full sort key
   * `(TenantId, OccurredAt, EvaluationId)`, and OccurredAt shifts as later
   * lifecycle events land, so superseded versions persist until TTL. The inner
   * dedup subquery reads only sort-key columns — no heavy Attributes map — so it
   * stays a cheap keyed seek.
   *
   * `window` bounds OccurredAt on the OUTER read only, keeping it a
   * partition-pruned point read. The inner dedup is deliberately UNWINDOWED so
   * it resolves the TRUE latest version; a windowed miss on a drifted latest
   * version yields an empty outer read, which the executor's unwindowed retry
   * recovers.
   */
  async findByEvaluationIdWithApplied({
    tenantId,
    evaluationId,
    window,
  }: {
    tenantId: string;
    evaluationId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{
    row: EvaluationAnalyticsRow;
    appliedEventIds: string[];
  } | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "EvaluationAnalyticsClickHouseRepository.findByEvaluationIdWithApplied",
    );
    const client = await this.resolveClient(tenantId);

    const partitionFilter =
      window !== undefined
        ? "AND OccurredAt BETWEEN fromUnixTimestamp64Milli({from:Int64}) AND fromUnixTimestamp64Milli({to:Int64})"
        : "";

    const result = await client.query({
      query: `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND EvaluationId = {evaluationId:String}
          ${partitionFilter}
          AND (TenantId, EvaluationId, UpdatedAt) IN (
            SELECT TenantId, EvaluationId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND EvaluationId = {evaluationId:String}
            GROUP BY TenantId, EvaluationId
          )
        LIMIT 1
      `,
      query_params: {
        tenantId,
        evaluationId,
        ...(window !== undefined
          ? { from: window.fromMs, to: window.toMs }
          : {}),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    const record = rows[0];
    if (!record) return null;
    return {
      row: fromRecord(record),
      appliedEventIds: asStringArray(record.AppliedEventIds),
    };
  }
}

/** Epoch-ms read-back column: "0" (or absent) reads back as null. */
const asNullableMs = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const asNullableBool = (value: unknown): boolean | null =>
  value === null || value === undefined ? null : Boolean(value);

/**
 * Decode a raw ClickHouse record into an {@link EvaluationAnalyticsRow}. The
 * inverse of {@link toClickHouseRecord}. A pre-migration record omits the 00056
 * fields, so the parsers fall back to the documented defaults (null timestamps,
 * empty applied set).
 */
function fromRecord(record: Record<string, unknown>): EvaluationAnalyticsRow {
  return {
    tenantId: String(record.TenantId ?? ""),
    evaluationId: String(record.EvaluationId ?? ""),
    version: String(record.Version ?? ""),
    occurredAtMs: new Date(String(record.OccurredAt)).getTime(),
    createdAtMs: new Date(String(record.CreatedAt)).getTime(),
    updatedAtMs: new Date(String(record.UpdatedAt)).getTime(),

    evaluatorType: String(record.EvaluatorType ?? ""),
    evaluatorName: asNullableString(record.EvaluatorName),
    status: String(record.Status ?? ""),
    isGuardrail: Boolean(record.IsGuardrail),
    passed: asNullableBool(record.Passed),
    score: asNullableNumber(record.Score),
    label: asNullableString(record.Label),
    model: asNullableString(record.Model),
    traceId: asNullableString(record.TraceId),
    userId: asNullableString(record.UserId),
    conversationId: asNullableString(record.ConversationId),
    customerId: asNullableString(record.CustomerId),
    origin: asNullableString(record.Origin),

    durationMs: asNumber(record.DurationMs),
    totalCost: asNullableNumber(record.TotalCost),
    nonBilledCost: asNullableNumber(record.NonBilledCost),

    attributes: asStringMap(record.Attributes),

    startedAtMs: asNullableMs(record.StartedAt),
    completedAtMs: asNullableMs(record.CompletedAt),
  };
}
