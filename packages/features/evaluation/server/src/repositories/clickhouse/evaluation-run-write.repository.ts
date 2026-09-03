import { EventUtils } from "@langwatch/eventing";
import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { createHash } from "node:crypto";
import type { EvaluationClickHouseResolver } from "../../ports/evaluation.port";

const TABLE_NAME = "evaluation_runs" as const;
const PROJECTION_VERSION = "2025-01-14" as const;
const DEFAULT_RETENTION_DAYS = 49;
const EVALUATION_RESOURCE = "eval";
const logger = createLogger("langwatch:evaluation:clickhouse.evaluation-run-write");

export interface ClickHouseEvaluationRunRecord {
  ProjectionId: string;
  TenantId: string;
  EvaluationId: string;
  Version: string;
  EvaluatorId: string;
  EvaluatorType: string;
  EvaluatorName: string | null;
  TraceId: string | null;
  IsGuardrail: number;
  Status: string;
  Score: number | null;
  Passed: number | null;
  Label: string | null;
  Details: string | null;
  Inputs: string | null;
  Error: string | null;
  ErrorDetails: string | null;
  CreatedAt: number | string;
  UpdatedAt: number | string;
  ArchivedAt: number | string | null;
  ScheduledAt: number | string | null;
  StartedAt: number | string | null;
  CompletedAt: number | string | null;
  CostId: string | null;
  LastProcessedEventId: string;
  LastEventOccurredAt: number | string;
  _retention_days: number;
}

type ClickHouseWriteRecord = Omit<
  ClickHouseEvaluationRunRecord,
  | "CreatedAt"
  | "UpdatedAt"
  | "ArchivedAt"
  | "ScheduledAt"
  | "StartedAt"
  | "CompletedAt"
  | "LastEventOccurredAt"
> & {
  CreatedAt: Date;
  UpdatedAt: Date;
  ArchivedAt: Date | null;
  ScheduledAt: Date;
  StartedAt: Date | null;
  CompletedAt: Date | null;
  LastEventOccurredAt: Date;
};

type BoundedText = {
  value: string | null;
  truncated: boolean;
  originalBytes: number;
};

function capInputs(serialized: string | null): BoundedText {
  const cap = 8 * 1024 * 1024;
  if (serialized === null) return { value: null, truncated: false, originalBytes: 0 };

  const originalBytes = Buffer.byteLength(serialized, "utf8");
  if (originalBytes <= cap) return { value: serialized, truncated: false, originalBytes };
  return {
    value: JSON.stringify({ __lw_truncated: { originalBytes, cap } }),
    truncated: true,
    originalBytes,
  };
}

function capText(value: string | null): BoundedText {
  const cap = 256 * 1024;
  if (value === null) return { value: null, truncated: false, originalBytes: 0 };

  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= cap) return { value, truncated: false, originalBytes: bytes.length };
  return {
    value: `${bytes.subarray(0, cap).toString("utf8")}…[lw-truncated]`,
    truncated: true,
    originalBytes: bytes.length,
  };
}

function validateTenant(tenantId: string, operation: string): void {
  EventUtils.validateTenantId({ tenantId }, operation);
}

function validateBatchTenants(entries: readonly { tenantId: string }[], operation: string): string {
  if (entries.length === 0) {
    throw new Error(`${operation}: cannot validate tenants on an empty batch`);
  }

  const tenantId = entries[0]!.tenantId;
  validateTenant(tenantId, operation);
  const mixed = entries.find((entry) => entry.tenantId !== tenantId);
  if (mixed) {
    throw new Error(`Mixed tenants in ${operation}: expected ${tenantId}, got ${mixed.tenantId}`);
  }
  return tenantId;
}

function deterministicProjectionId(
  tenantId: string,
  evaluationId: string,
  scheduledAtMs: number | null,
): string {
  if (scheduledAtMs === null) return evaluationId;

  const hash = createHash("sha256").update(`${tenantId}:${evaluationId}`).digest();
  const instance = new Instance(Instance.schemes.RANDOM, new Uint8Array(hash.subarray(0, 8)));
  return new Ksuid(
    getEnvironment(),
    EVALUATION_RESOURCE,
    Math.floor(scheduledAtMs / 1000),
    instance,
    0,
  ).toString();
}

/** Owns the evaluation_runs insert shape and write-side bounds. */
export class EvaluationRunClickHouseWriteRepository {
  static create(options: {
    resolveClient: EvaluationClickHouseResolver;
  }): EvaluationRunClickHouseWriteRepository {
    return new EvaluationRunClickHouseWriteRepository(options);
  }

  private constructor(private readonly options: { resolveClient: EvaluationClickHouseResolver }) {}

  async upsert(input: {
    data: EvaluationRunData;
    tenantId: string;
    retentionDays?: number;
  }): Promise<void> {
    validateTenant(input.tenantId, "EvaluationRunClickHouseWriteRepository.upsert");
    try {
      const client = await this.options.resolveClient(input.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [this.toClickHouseRecord(input.data, input.tenantId, input.retentionDays)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
        { tenantId: input.tenantId, evaluationId: input.data.evaluationId, error },
        "Failed to store evaluation run in ClickHouse",
      );
      throw error;
    }
  }

  async upsertBatch(
    entries: Array<{
      data: EvaluationRunData;
      tenantId: string;
      retentionDays?: number;
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = validateBatchTenants(
      entries,
      "EvaluationRunClickHouseWriteRepository.upsertBatch",
    );
    try {
      const client = await this.options.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: entries.map((entry) =>
          this.toClickHouseRecord(entry.data, entry.tenantId, entry.retentionDays),
        ),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
        { tenantId, count: entries.length, error },
        "Failed to batch store evaluation runs in ClickHouse",
      );
      throw error;
    }
  }

  private toClickHouseRecord(
    data: EvaluationRunData,
    tenantId: string,
    retentionDays?: number,
  ): ClickHouseWriteRecord {
    const projectionId = deterministicProjectionId(tenantId, data.evaluationId, data.scheduledAt);
    const inputs = capInputs(data.inputs ? JSON.stringify(data.inputs) : null);
    const details = capText(data.details);
    const error = capText(data.error);
    const errorDetails = capText(data.errorDetails);
    if (inputs.truncated || details.truncated || error.truncated || errorDetails.truncated) {
      logger.warn(
        {
          tenantId,
          evaluationId: data.evaluationId,
          inputsOriginalBytes: inputs.originalBytes,
          detailsOriginalBytes: details.originalBytes,
          errorOriginalBytes: error.originalBytes,
          errorDetailsOriginalBytes: errorDetails.originalBytes,
          inputsTruncated: inputs.truncated,
          detailsTruncated: details.truncated,
          errorTruncated: error.truncated,
          errorDetailsTruncated: errorDetails.truncated,
        },
        "evaluation_runs row exceeded a column cap and was truncated at write to stay merge-safe",
      );
    }

    return {
      ProjectionId: projectionId,
      TenantId: tenantId,
      EvaluationId: data.evaluationId,
      Version: PROJECTION_VERSION,
      EvaluatorId: data.evaluatorId,
      EvaluatorType: data.evaluatorType,
      EvaluatorName: data.evaluatorName,
      TraceId: data.traceId,
      IsGuardrail: data.isGuardrail ? 1 : 0,
      Status: data.status,
      Score: data.score,
      Passed: data.passed === null ? null : data.passed ? 1 : 0,
      Label: data.label,
      Details: details.value,
      Inputs: inputs.value,
      Error: error.value,
      ErrorDetails: errorDetails.value,
      CreatedAt: new Date(data.createdAt),
      UpdatedAt: new Date(data.updatedAt),
      ArchivedAt: data.archivedAt === null ? null : new Date(data.archivedAt),
      ScheduledAt: new Date(data.scheduledAt ?? data.createdAt),
      StartedAt: data.startedAt === null ? null : new Date(data.startedAt),
      CompletedAt: data.completedAt === null ? null : new Date(data.completedAt),
      CostId: data.costId,
      LastProcessedEventId: projectionId,
      LastEventOccurredAt: new Date(data.LastEventOccurredAt || 0),
      _retention_days: retentionDays ?? DEFAULT_RETENTION_DAYS,
    };
  }
}
