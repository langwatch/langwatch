import { EventUtils } from "@langwatch/eventing";
import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  evaluationRunDataSchema,
  evaluationSummarySchema,
  traceEvaluationDataSchema,
  type EvaluationRunData,
  type EvaluationRunLookup,
  type EvaluationSummary,
  type TraceEvaluationData,
} from "@langwatch/evaluation-contract";
import { createHash } from "node:crypto";
import {
  type EvaluationClickHouseClient,
  type EvaluationClickHouseResolver,
  type EvaluationRetentionFloorPort,
} from "../../ports/evaluation.port";
import { EvaluationRunRepository } from "../evaluation.repository";

const TABLE_NAME = "evaluation_runs" as const;
const PROJECTION_VERSION = "2025-01-14" as const;
const DEFAULT_RETENTION_DAYS = 49;
const RESOLVER_RECENT_WINDOW_MS = 35 * 24 * 60 * 60 * 1000;
const DEFAULT_SCHEDULED_AT_SLACK_MS = 7 * 24 * 60 * 60 * 1000;
const EVALUATION_RESOURCE = "eval";
const TRACE_EVALUATION_COLUMNS_LIGHT = [
  "ProjectionId",
  "TenantId",
  "EvaluationId",
  "Version",
  "EvaluatorId",
  "EvaluatorType",
  "EvaluatorName",
  "TraceId",
  "IsGuardrail",
  "Status",
  "Score",
  "Passed",
  "Label",
  "Details",
  "Error",
  "ScheduledAt",
  "StartedAt",
  "CompletedAt",
  "LastProcessedEventId",
  "UpdatedAt",
].join(", ");
const TRACE_EVALUATION_COLUMNS_WITH_INPUTS = `${TRACE_EVALUATION_COLUMNS_LIGHT}, Inputs`;

const logger = createLogger("langwatch:evaluation:clickhouse.evaluation.repository");

interface ClickHouseEvaluationRunRecord {
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

const capInputs = (
  serialized: string | null,
): {
  value: string | null;
  truncated: boolean;
  originalBytes: number;
} => {
  const cap = 8 * 1024 * 1024;
  if (serialized === null) return { value: null, truncated: false, originalBytes: 0 };
  const originalBytes = Buffer.byteLength(serialized, "utf8");
  if (originalBytes <= cap) return { value: serialized, truncated: false, originalBytes };
  return {
    value: JSON.stringify({ __lw_truncated: { originalBytes, cap } }),
    truncated: true,
    originalBytes,
  };
};

const capText = (
  value: string | null,
): {
  value: string | null;
  truncated: boolean;
  originalBytes: number;
} => {
  const cap = 256 * 1024;
  if (value === null) return { value: null, truncated: false, originalBytes: 0 };
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= cap)
    return { value, truncated: false, originalBytes: bytes.length };
  return {
    value: `${bytes.subarray(0, cap).toString("utf8")}…[lw-truncated]`,
    truncated: true,
    originalBytes: bytes.length,
  };
};

function validateTenant(tenantId: string, operation: string): void {
  EventUtils.validateTenantId({ tenantId }, operation);
}

function validateBatchTenants(
  entries: readonly { tenantId: string }[],
  operation: string,
): string {
  if (entries.length === 0) {
    throw new Error(`${operation}: cannot validate tenants on an empty batch`);
  }
  const tenantId = entries[0]!.tenantId;
  validateTenant(tenantId, operation);
  const mixed = entries.find((entry) => entry.tenantId !== tenantId);
  if (mixed) {
    throw new Error(
      `Mixed tenants in ${operation}: expected ${tenantId}, got ${mixed.tenantId}`,
    );
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
  const instance = new Instance(
    Instance.schemes.RANDOM,
    new Uint8Array(hash.subarray(0, 8)),
  );
  return new Ksuid(
    getEnvironment(),
    EVALUATION_RESOURCE,
    Math.floor(scheduledAtMs / 1000),
    instance,
    0,
  ).toString();
}

function numberOrNull(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function isMemoryLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /memory limit\s*(exceeded|.*exceeded)/i.test(message);
}

function parseObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Private, retention-aware ClickHouse persistence for evaluation runs. */
export class ClickHouseEvaluationRepository extends EvaluationRunRepository {
  static create(options: {
    resolveClient: EvaluationClickHouseResolver;
    retentionFloor: EvaluationRetentionFloorPort;
  }): ClickHouseEvaluationRepository {
    return new ClickHouseEvaluationRepository(options);
  }

  private constructor(
    private readonly options: {
      resolveClient: EvaluationClickHouseResolver;
      retentionFloor: EvaluationRetentionFloorPort;
    },
  ) {
    super();
  }

  async upsert(input: {
    data: EvaluationRunData;
    tenantId: string;
    retentionDays?: number;
  }): Promise<void> {
    validateTenant(input.tenantId, "ClickHouseEvaluationRepository.upsert");
    try {
      const client = await this.options.resolveClient(input.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [
          this.toClickHouseRecord(input.data, input.tenantId, input.retentionDays),
        ],
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
      "ClickHouseEvaluationRepository.upsertBatch",
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

  async tryFindByEvaluationId(
    input: EvaluationRunLookup,
  ): Promise<EvaluationRunData | null> {
    validateTenant(
      input.tenantId,
      "ClickHouseEvaluationRepository.tryFindByEvaluationId",
    );
    try {
      const { scheduledAtFrom, scheduledAtTo } =
        await this.resolveScheduledAtRange(input);
      const bounds = (column: string): string =>
        `AND ${column} >= fromUnixTimestamp64Milli({scheduledAtFrom:Int64})` +
        (scheduledAtTo === undefined
          ? ""
          : ` AND ${column} <= fromUnixTimestamp64Milli({scheduledAtTo:Int64})`);
      const client = await this.options.resolveClient(input.tenantId);
      const result = await client.query({
        query: `
          SELECT
            t.ProjectionId AS ProjectionId, t.TenantId AS TenantId,
            t.EvaluationId AS EvaluationId, t.Version AS Version,
            t.EvaluatorId AS EvaluatorId, t.EvaluatorType AS EvaluatorType,
            t.EvaluatorName AS EvaluatorName, t.TraceId AS TraceId,
            t.IsGuardrail AS IsGuardrail, t.Status AS Status, t.Score AS Score,
            t.Passed AS Passed, t.Label AS Label, t.Details AS Details,
            t.Inputs AS Inputs, t.Error AS Error, t.ErrorDetails AS ErrorDetails,
            toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(t.ArchivedAt) AS ArchivedAt,
            toUnixTimestamp64Milli(t.ScheduledAt) AS ScheduledAt,
            toUnixTimestamp64Milli(t.StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(t.CompletedAt) AS CompletedAt,
            t.CostId AS CostId, t.LastProcessedEventId AS LastProcessedEventId,
            toUnixTimestamp64Milli(t.LastEventOccurredAt) AS LastEventOccurredAt
          FROM ${TABLE_NAME} AS t
          PREWHERE (t.TenantId, t.EvaluationId, t.UpdatedAt) IN (
            SELECT TenantId, EvaluationId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND EvaluationId = {evaluationId:String}
              ${bounds("ScheduledAt")}
            GROUP BY TenantId, EvaluationId
          )
          WHERE t.TenantId = {tenantId:String}
            AND t.EvaluationId = {evaluationId:String}
            ${bounds("t.ScheduledAt")}
          LIMIT 1
        `,
        query_params: {
          tenantId: input.tenantId,
          evaluationId: input.evaluationId,
          scheduledAtFrom,
          ...(scheduledAtTo === undefined ? {} : { scheduledAtTo }),
        },
        format: "JSONEachRow",
      });
      const row = (await result.json<ClickHouseEvaluationRunRecord>())[0];
      return row ? this.fromClickHouseRecord(row) : null;
    } catch (error) {
      logger.warn(
        { tenantId: input.tenantId, evaluationId: input.evaluationId, error },
        "Failed to get evaluation run from ClickHouse",
      );
      throw error;
    }
  }

  async findByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<EvaluationRunData[]> {
    validateTenant(input.tenantId, "ClickHouseEvaluationRepository.findByTraceId");
    try {
      const client = await this.options.resolveClient(input.tenantId);
      const result = await client.query({
        query: `
          SELECT ProjectionId, TenantId, EvaluationId, Version, EvaluatorId,
            EvaluatorType, EvaluatorName, TraceId, IsGuardrail, Status, Score,
            Passed, Label, Details, Inputs, Error, ErrorDetails,
            toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(ArchivedAt) AS ArchivedAt,
            toUnixTimestamp64Milli(ScheduledAt) AS ScheduledAt,
            toUnixTimestamp64Milli(StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(CompletedAt) AS CompletedAt, CostId,
            LastProcessedEventId,
            toUnixTimestamp64Milli(LastEventOccurredAt) AS LastEventOccurredAt
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND ScheduledAt >= now() - INTERVAL 7 DAY
            AND TraceId = {traceId:String}
            AND (TenantId, EvaluationId, UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND ScheduledAt >= now() - INTERVAL 7 DAY
                AND TraceId = {traceId:String}
              GROUP BY TenantId, EvaluationId
            )
          ORDER BY UpdatedAt DESC
        `,
        query_params: { tenantId: input.tenantId, traceId: input.traceId },
        format: "JSONEachRow",
      });
      return (await result.json<ClickHouseEvaluationRunRecord>()).map((row) =>
        this.fromClickHouseRecord(row),
      );
    } catch (error) {
      logger.warn(
        { tenantId: input.tenantId, traceId: input.traceId, error },
        "Failed to find evaluation runs by trace ID in ClickHouse",
      );
      throw error;
    }
  }

  async findSummariesByTraceIds(input: {
    tenantId: string;
    traceIds: string[];
    since: number;
  }): Promise<Record<string, EvaluationSummary[]>> {
    if (input.traceIds.length === 0) return {};
    validateTenant(
      input.tenantId,
      "ClickHouseEvaluationRepository.findSummariesByTraceIds",
    );
    try {
      const client = await this.options.resolveClient(input.tenantId);
      const result = await client.query({
        query: `
          SELECT EvaluationId, EvaluatorId, EvaluatorType, EvaluatorName,
            TraceId, IsGuardrail, Status, Score, Passed, Label
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND ScheduledAt >= fromUnixTimestamp64Milli({since:Int64})
            AND TraceId IN ({traceIds:Array(String)})
            AND (TenantId, EvaluationId, UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND ScheduledAt >= fromUnixTimestamp64Milli({since:Int64})
                AND TraceId IN ({traceIds:Array(String)})
              GROUP BY TenantId, EvaluationId
            )
          ORDER BY UpdatedAt DESC
        `,
        query_params: {
          tenantId: input.tenantId,
          traceIds: input.traceIds,
          since: input.since,
        },
        format: "JSONEachRow",
      });
      const output: Record<string, EvaluationSummary[]> = {};
      for (const row of await result.json<ClickHouseEvaluationRunRecord>()) {
        if (!row.TraceId) continue;
        const summary = evaluationSummarySchema.parse({
          evaluationId: row.EvaluationId,
          evaluatorId: row.EvaluatorId,
          evaluatorType: row.EvaluatorType,
          evaluatorName: row.EvaluatorName,
          traceId: row.TraceId,
          isGuardrail: Boolean(row.IsGuardrail),
          status: row.Status,
          score: row.Score,
          passed: row.Passed === null ? null : Boolean(row.Passed),
          label: row.Label,
        });
        (output[row.TraceId] ??= []).push(summary);
      }
      return output;
    } catch (error) {
      logger.warn(
        { tenantId: input.tenantId, traceIdCount: input.traceIds.length, error },
        "Failed to find evaluation summaries by trace IDs in ClickHouse",
      );
      throw error;
    }
  }

  async findTraceEvaluations(input: {
    tenantId: string;
    traceIds: string[];
  }): Promise<Record<string, TraceEvaluationData[]>> {
    if (input.traceIds.length === 0) return {};
    validateTenant(input.tenantId, "ClickHouseEvaluationRepository.findTraceEvaluations");
    const client = await this.options.resolveClient(input.tenantId);
    try {
      return await this.queryTraceEvaluations({
        client,
        tenantId: input.tenantId,
        traceIds: input.traceIds,
        columns: TRACE_EVALUATION_COLUMNS_WITH_INPUTS,
      });
    } catch (error) {
      if (!isMemoryLimitError(error)) {
        logger.error(
          { tenantId: input.tenantId, traceIdCount: input.traceIds.length, error },
          "Failed to fetch trace evaluations from ClickHouse",
        );
        throw error;
      }
      logger.warn(
        { tenantId: input.tenantId, traceIdCount: input.traceIds.length },
        "Trace evaluation read hit the ClickHouse memory limit; retrying without inputs",
      );
      return this.queryTraceEvaluations({
        client,
        tenantId: input.tenantId,
        traceIds: input.traceIds,
        columns: TRACE_EVALUATION_COLUMNS_LIGHT,
      });
    }
  }

  async tryFindInputs(input: {
    tenantId: string;
    evaluationId: string;
  }): Promise<Record<string, unknown> | null> {
    validateTenant(input.tenantId, "ClickHouseEvaluationRepository.tryFindInputs");
    let client: EvaluationClickHouseClient;
    try {
      client = await this.options.resolveClient(input.tenantId);
    } catch (error) {
      logger.warn(
        { tenantId: input.tenantId, evaluationId: input.evaluationId, error },
        "ClickHouse client unavailable for evaluation inputs",
      );
      return null;
    }
    try {
      const result = await client.query({
        query: `
          SELECT argMax(Inputs, UpdatedAt) AS Inputs
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND EvaluationId = {evaluationId:String}
        `,
        query_params: input,
        format: "JSONEachRow",
      });
      const row = (await result.json<{ Inputs: string | null }>())[0];
      return parseObject(row?.Inputs ?? null);
    } catch (error) {
      if (isMemoryLimitError(error)) {
        logger.warn(
          { tenantId: input.tenantId, evaluationId: input.evaluationId },
          "Evaluation inputs read hit the ClickHouse memory limit",
        );
        return null;
      }
      logger.warn(
        { tenantId: input.tenantId, evaluationId: input.evaluationId, error },
        "Failed to fetch evaluation inputs from ClickHouse",
      );
      throw error;
    }
  }

  private async queryTraceEvaluations(input: {
    client: EvaluationClickHouseClient;
    tenantId: string;
    traceIds: string[];
    columns: string;
  }): Promise<Record<string, TraceEvaluationData[]>> {
    const result = await input.client.query({
      query: `
        SELECT ${input.columns}
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND TraceId IN ({traceIds:Array(String)})
          AND (TenantId, EvaluationId, UpdatedAt) IN (
            SELECT TenantId, EvaluationId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId IN ({traceIds:Array(String)})
            GROUP BY TenantId, EvaluationId
          )
      `,
      query_params: { tenantId: input.tenantId, traceIds: input.traceIds },
      format: "JSONEachRow",
    });
    const output = Object.fromEntries(
      input.traceIds.map((traceId) => [traceId, [] as TraceEvaluationData[]]),
    );
    for (const row of await result.json<ClickHouseEvaluationRunRecord>()) {
      if (!row.TraceId) continue;
      const traceEvaluation = traceEvaluationDataSchema.parse({
        evaluationId: row.EvaluationId,
        evaluatorId: row.EvaluatorId,
        evaluatorType: row.EvaluatorType,
        evaluatorName: row.EvaluatorName,
        traceId: row.TraceId,
        isGuardrail: Boolean(row.IsGuardrail),
        status: row.Status,
        score: row.Score,
        passed: row.Passed === null ? null : Boolean(row.Passed),
        label: row.Label,
        details: row.Details,
        error: row.Error,
        ...(Object.prototype.hasOwnProperty.call(row, "Inputs")
          ? { inputs: parseObject(row.Inputs) }
          : {}),
        timestamps: {
          scheduledAt: numberOrNull(row.ScheduledAt),
          startedAt: numberOrNull(row.StartedAt),
          completedAt: numberOrNull(row.CompletedAt),
        },
      });
      (output[row.TraceId] ??= []).push(traceEvaluation);
    }
    return output;
  }

  private async resolveScheduledAtRange(input: EvaluationRunLookup): Promise<{
    scheduledAtFrom: number;
    scheduledAtTo?: number;
  }> {
    const slackMs = input.scheduledAtSlackMs ?? DEFAULT_SCHEDULED_AT_SLACK_MS;
    if (input.scheduledAt) {
      return {
        scheduledAtFrom: input.scheduledAt.getTime() - slackMs,
        scheduledAtTo: input.scheduledAt.getTime() + slackMs,
      };
    }

    const floorMs = await this.options.retentionFloor.getFloorMs({
      table: TABLE_NAME,
      tenantId: input.tenantId,
    });
    const recent = await this.queryScheduledAtMs({
      tenantId: input.tenantId,
      evaluationId: input.evaluationId,
      sinceMs: Date.now() - RESOLVER_RECENT_WINDOW_MS,
    });
    if (recent !== undefined) {
      return { scheduledAtFrom: recent - slackMs, scheduledAtTo: recent + slackMs };
    }
    const fallback = await this.queryScheduledAtMs({
      tenantId: input.tenantId,
      evaluationId: input.evaluationId,
      sinceMs: floorMs,
    });
    return fallback === undefined
      ? { scheduledAtFrom: floorMs }
      : { scheduledAtFrom: fallback - slackMs, scheduledAtTo: fallback + slackMs };
  }

  private async queryScheduledAtMs(input: {
    tenantId: string;
    evaluationId: string;
    sinceMs: number;
  }): Promise<number | undefined> {
    const client = await this.options.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT toUnixTimestamp64Milli(argMax(ScheduledAt, UpdatedAt)) AS scheduledAtMs
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND EvaluationId = {evaluationId:String}
          AND ScheduledAt >= fromUnixTimestamp64Milli({sinceMs:Int64})
      `,
      query_params: {
        tenantId: input.tenantId,
        evaluationId: input.evaluationId,
        sinceMs: input.sinceMs,
      },
      format: "JSONEachRow",
    });
    const raw = (await result.json<{ scheduledAtMs: number | string | null }>())[0]
      ?.scheduledAtMs;
    if (raw === null || raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  private toClickHouseRecord(
    data: EvaluationRunData,
    tenantId: string,
    retentionDays?: number,
  ): ClickHouseWriteRecord {
    const projectionId = deterministicProjectionId(
      tenantId,
      data.evaluationId,
      data.scheduledAt,
    );
    const inputs = capInputs(data.inputs ? JSON.stringify(data.inputs) : null);
    const details = capText(data.details);
    const error = capText(data.error);
    const errorDetails = capText(data.errorDetails);
    if (
      inputs.truncated ||
      details.truncated ||
      error.truncated ||
      errorDetails.truncated
    ) {
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

  private fromClickHouseRecord(row: ClickHouseEvaluationRunRecord): EvaluationRunData {
    return evaluationRunDataSchema.parse({
      evaluationId: row.EvaluationId,
      evaluatorId: row.EvaluatorId,
      evaluatorType: row.EvaluatorType,
      evaluatorName: row.EvaluatorName,
      traceId: row.TraceId,
      isGuardrail: Boolean(row.IsGuardrail),
      status: row.Status,
      score: row.Score,
      passed: row.Passed === null ? null : Boolean(row.Passed),
      label: row.Label,
      details: row.Details,
      inputs: row.Inputs ? (JSON.parse(row.Inputs) as Record<string, unknown>) : null,
      error: row.Error,
      errorDetails: row.ErrorDetails,
      createdAt: Number(row.CreatedAt),
      updatedAt: Number(row.UpdatedAt),
      LastEventOccurredAt: Number(row.LastEventOccurredAt ?? 0),
      archivedAt: numberOrNull(row.ArchivedAt),
      scheduledAt: numberOrNull(row.ScheduledAt),
      startedAt: numberOrNull(row.StartedAt),
      completedAt: numberOrNull(row.CompletedAt),
      costId: row.CostId,
    });
  }
}
