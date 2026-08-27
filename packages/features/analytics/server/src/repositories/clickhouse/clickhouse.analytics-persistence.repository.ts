import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  analyticsEvaluationReadInputSchema,
  analyticsEvaluationRollupAppendBatchInputSchema,
  analyticsEvaluationRollupAppendInputSchema,
  analyticsEvaluationRowSchema,
  analyticsEvaluationUpsertBatchInputSchema,
  analyticsEvaluationUpsertInputSchema,
  type AnalyticsEvaluationReadMetrics,
  type AnalyticsEvaluationRollupRow,
  type AnalyticsEvaluationRow,
  type AnalyticsEvaluationReadInput,
  type AnalyticsEvaluationRollupAppendBatchInput,
  type AnalyticsEvaluationRollupAppendInput,
  type AnalyticsEvaluationUpsertInput,
} from "@langwatch/analytics-contract";
import type { ClickHouseSettings } from "@clickhouse/client";
import { z } from "zod";
import { AnalyticsEvaluationRepository } from "../analytics-persistence.repository";

const SLIM_TABLE = "evaluation_analytics";
const ROLLUP_TABLE = "evaluation_analytics_rollup";
const INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
  input_format_skip_unknown_fields: 0,
} as const;
const logger = createLogger("langwatch:analytics:evaluation-analytics-repository");

export type EvaluationAnalyticsClickHouseClient = {
  insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<unknown>;
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<{
    json(): Promise<Record<string, unknown>[]>;
  }>;
};

export class ClickHouseAnalyticsEvaluationRepository extends AnalyticsEvaluationRepository {
  static create(options: {
    resolveClient: (tenantId: string) => Promise<EvaluationAnalyticsClickHouseClient | null>;
    defaultRetentionDays: number;
    readMetrics?: AnalyticsEvaluationReadMetrics;
  }): ClickHouseAnalyticsEvaluationRepository {
    return new ClickHouseAnalyticsEvaluationRepository(
      options.resolveClient,
      options.defaultRetentionDays,
      options.readMetrics,
    );
  }

  private constructor(
    private readonly resolveClient: (
      tenantId: string,
    ) => Promise<EvaluationAnalyticsClickHouseClient | null>,
    private readonly defaultRetentionDays: number,
    private readonly readMetrics?: AnalyticsEvaluationReadMetrics,
  ) {
    super();
  }

  async upsert(input: AnalyticsEvaluationUpsertInput): Promise<void> {
    const parsed = analyticsEvaluationUpsertInputSchema.parse(input);
    this.validateTenant(parsed.row.tenantId, "upsert");
    try {
      const client = await this.clientFor(parsed.row.tenantId);
      await client.insert({
        table: SLIM_TABLE,
        values: [
          toSlimRecord(
            parsed.row,
            parsed.retentionDays ?? this.defaultRetentionDays,
            parsed.appliedEventIds,
          ),
        ],
        format: "JSONEachRow",
        clickhouse_settings: INSERT_SETTINGS,
      });
    } catch (error) {
      logger.warn(
        { tenantId: parsed.row.tenantId, evaluationId: parsed.row.evaluationId, error },
        "Failed to upsert evaluation analytics row",
      );
      throw error;
    }
  }

  async upsertBatch(input: AnalyticsEvaluationUpsertInput[]): Promise<void> {
    const entries = analyticsEvaluationUpsertBatchInputSchema.parse(input);
    if (entries.length === 0) return;

    const first = entries[0];
    if (!first) return;

    const tenantId = first.row.tenantId;
    this.validateTenant(tenantId, "upsertBatch");
    for (const entry of entries) {
      if (entry.row.tenantId !== tenantId) {
        throw new SecurityError(
          "AnalyticsEvaluationRepository.upsertBatch",
          "all rows in a single batch must share one tenantId",
          tenantId,
          { mismatchedTenantId: entry.row.tenantId },
        );
      }
    }
    try {
      const client = await this.clientFor(tenantId);
      await client.insert({
        table: SLIM_TABLE,
        values: entries.map((entry) =>
          toSlimRecord(
            entry.row,
            entry.retentionDays ?? this.defaultRetentionDays,
            entry.appliedEventIds,
          ),
        ),
        format: "JSONEachRow",
        clickhouse_settings: INSERT_SETTINGS,
      });
    } catch (error) {
      logger.warn(
        { tenantId, count: entries.length, error },
        "Failed to batch upsert evaluation analytics rows",
      );
      throw error;
    }
  }

  async tryFind(
    input: AnalyticsEvaluationReadInput,
  ): Promise<{ row: AnalyticsEvaluationRow; appliedEventIds: string[] } | null> {
    const parsed = analyticsEvaluationReadInputSchema.parse(input);
    this.validateTenant(parsed.tenantId, "tryFind");
    try {
      const client = await this.clientFor(parsed.tenantId);
      const range = parsed.window
        ? "AND OccurredAt BETWEEN fromUnixTimestamp64Milli({from:Int64}) AND fromUnixTimestamp64Milli({to:Int64})"
        : "";
      const result = await client.query({
        query: `
          SELECT * FROM ${SLIM_TABLE}
          WHERE TenantId = {tenantId:String}
            AND EvaluationId = {evaluationId:String}
            ${range}
            AND (TenantId, EvaluationId, UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM ${SLIM_TABLE}
              WHERE TenantId = {tenantId:String}
                AND EvaluationId = {evaluationId:String}
              GROUP BY TenantId, EvaluationId
            )
          ORDER BY OccurredAt DESC, CompletedAt DESC, StartedAt DESC,
            length(AppliedEventIds) DESC
          LIMIT 1
        `,
        query_params: {
          tenantId: parsed.tenantId,
          evaluationId: parsed.evaluationId,
          ...(parsed.window ? { from: parsed.window.fromMs, to: parsed.window.toMs } : {}),
        },
        format: "JSONEachRow",
      });
      const rows = await result.json();
      const record = rows[0];
      this.readMetrics?.record({
        table: "evaluation_analytics",
        outcome: parsed.window ? (record ? "hit" : "windowed_empty") : "unwindowed",
      });
      return record ? fromSlimRecord(record) : null;
    } catch (error) {
      this.readMetrics?.record({ table: "evaluation_analytics", outcome: "error" });
      logger.warn(
        { tenantId: parsed.tenantId, evaluationId: parsed.evaluationId, error },
        "Failed to read evaluation analytics row",
      );
      throw error;
    }
  }

  async appendRollup(input: AnalyticsEvaluationRollupAppendInput): Promise<void> {
    const parsed = analyticsEvaluationRollupAppendInputSchema.parse(input);
    this.validateTenant(parsed.row.tenantId, "appendRollup");
    const client = await this.clientFor(parsed.row.tenantId);
    await client.insert({
      table: ROLLUP_TABLE,
      values: [toRollupRecord(parsed.row, parsed.retentionDays ?? this.defaultRetentionDays)],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }

  async appendRollupBatch(input: AnalyticsEvaluationRollupAppendBatchInput): Promise<void> {
    const parsed = analyticsEvaluationRollupAppendBatchInputSchema.parse(input);
    if (parsed.rows.length === 0) return;

    const first = parsed.rows[0];
    if (!first) return;

    const tenantId = first.tenantId;
    this.validateTenant(tenantId, "appendRollupBatch");
    for (const row of parsed.rows) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "AnalyticsEvaluationRepository.appendRollupBatch",
          "all rows in a single batch must share one tenantId",
          tenantId,
          { mismatchedTenantId: row.tenantId },
        );
      }
    }
    const client = await this.clientFor(tenantId);
    await client.insert({
      table: ROLLUP_TABLE,
      values: parsed.rows.map((row) =>
        toRollupRecord(row, parsed.retentionDays ?? this.defaultRetentionDays),
      ),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }

  private async clientFor(tenantId: string): Promise<EvaluationAnalyticsClickHouseClient> {
    const client = await this.resolveClient(tenantId);
    if (!client) throw new Error(`ClickHouse client unavailable for ${tenantId}`);
    return client;
  }

  private validateTenant(tenantId: string, operation: string): void {
    EventUtils.validateTenantId({ tenantId }, `AnalyticsEvaluationRepository.${operation}`);
  }
}

function toSlimRecord(
  row: AnalyticsEvaluationRow,
  retentionDays: number,
  appliedEventIds: readonly string[] = [],
) {
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
    StartedAt: row.startedAtMs && row.startedAtMs > 0 ? String(Math.round(row.startedAtMs)) : "0",
    CompletedAt:
      row.completedAtMs && row.completedAtMs > 0 ? String(Math.round(row.completedAtMs)) : "0",
    AppliedEventIds: [...appliedEventIds],
    _retention_days: retentionDays,
  };
}

function toRollupRecord(row: AnalyticsEvaluationRollupRow, retentionDays: number) {
  return {
    TenantId: row.tenantId,
    BucketStart: row.bucketStart,
    EvaluatorType: row.evaluatorType,
    Status: row.status,
    EvalCount: String(row.evalCount),
    PassCount: String(row.passCount),
    FailCount: String(row.failCount),
    ErrorCount: String(row.errorCount),
    SkippedCount: String(row.skippedCount),
    ScoreCount: String(row.scoreCount),
    ScoreSum: row.scoreSum,
    CostSum: row.costSum,
    NonBilledCostSum: row.nonBilledCostSum,
    DurationSum: String(row.durationSum),
    _retention_days: retentionDays,
  };
}

const rawStringSchema = z.union([z.string(), z.number()]).transform(String);
const nullableRawStringSchema = rawStringSchema
  .nullable()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null));
const rawNumberSchema = z
  .union([z.number(), z.string()])
  .transform(Number)
  .transform((value) => (Number.isFinite(value) ? value : 0));
const nullableRawNumberSchema = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((value) => (value === null || value === void 0 ? null : Number(value)))
  .transform((value) => (value === null || Number.isFinite(value) ? value : null));
const nullableRawMillisecondsSchema = nullableRawNumberSchema.transform((value) =>
  value !== null && value > 0 ? value : null,
);
const rawDateMillisecondsSchema = z
  .union([z.date(), z.number(), z.string()])
  .transform((value) => {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;

    const normalized = value.includes("T") ? value : value.replace(" ", "T");
    const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
    return new Date(zoned).getTime();
  })
  .transform((value) => (Number.isFinite(value) ? value : 0));
const rawBooleanSchema = z
  .union([z.boolean(), z.literal(0), z.literal(1), z.literal("0"), z.literal("1")])
  .transform((value) => value === true || value === 1 || value === "1");
const nullableRawBooleanSchema = z
  .union([z.boolean(), z.literal(0), z.literal(1), z.literal("0"), z.literal("1")])
  .nullable()
  .optional()
  .transform((value) =>
    value === null || value === void 0 ? null : value === true || value === 1 || value === "1",
  );

const evaluationAnalyticsClickHouseRowSchema = z
  .object({
    TenantId: rawStringSchema.default(""),
    EvaluationId: rawStringSchema.default(""),
    Version: rawStringSchema.default(""),
    OccurredAt: rawDateMillisecondsSchema.default(0),
    CreatedAt: rawDateMillisecondsSchema.default(0),
    UpdatedAt: rawDateMillisecondsSchema.default(0),
    EvaluatorType: rawStringSchema.default(""),
    EvaluatorName: nullableRawStringSchema,
    Status: rawStringSchema.default(""),
    IsGuardrail: rawBooleanSchema.default(false),
    Passed: nullableRawBooleanSchema,
    Score: nullableRawNumberSchema,
    Label: nullableRawStringSchema,
    Model: nullableRawStringSchema,
    TraceId: nullableRawStringSchema,
    UserId: nullableRawStringSchema,
    ConversationId: nullableRawStringSchema,
    CustomerId: nullableRawStringSchema,
    Origin: nullableRawStringSchema,
    DurationMs: rawNumberSchema.default(0),
    TotalCost: nullableRawNumberSchema,
    NonBilledCost: nullableRawNumberSchema,
    Attributes: z.record(z.string(), z.string()).catch({}),
    StartedAt: nullableRawMillisecondsSchema,
    CompletedAt: nullableRawMillisecondsSchema,
    AppliedEventIds: z.array(z.string()).catch([]),
  })
  .transform((row) => ({
    row: analyticsEvaluationRowSchema.parse({
      tenantId: row.TenantId,
      evaluationId: row.EvaluationId,
      version: row.Version,
      occurredAtMs: row.OccurredAt,
      createdAtMs: row.CreatedAt,
      updatedAtMs: row.UpdatedAt,
      evaluatorType: row.EvaluatorType,
      evaluatorName: row.EvaluatorName,
      status: row.Status,
      isGuardrail: row.IsGuardrail,
      passed: row.Passed,
      score: row.Score,
      label: row.Label,
      model: row.Model,
      traceId: row.TraceId,
      userId: row.UserId,
      conversationId: row.ConversationId,
      customerId: row.CustomerId,
      origin: row.Origin,
      durationMs: row.DurationMs,
      totalCost: row.TotalCost,
      nonBilledCost: row.NonBilledCost,
      attributes: row.Attributes,
      startedAtMs: row.StartedAt,
      completedAtMs: row.CompletedAt,
    }),
    appliedEventIds: row.AppliedEventIds,
  }));

function fromSlimRecord(record: Record<string, unknown>): {
  row: AnalyticsEvaluationRow;
  appliedEventIds: string[];
} {
  return evaluationAnalyticsClickHouseRowSchema.parse(record);
}
