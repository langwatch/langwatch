import type { Authorization } from "@langwatch/authorization";
import {
  type AuthorizedClickHouse,
  DEFAULT_PARTITION_WINDOW_MS,
  queryWindowed,
  type TenantScopedReader,
  tenantScope,
  tenantScopeKey,
  tenantSet,
} from "@langwatch/clickhouse-client";
import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  firstUsableAnchor,
  isStorageAnchoredVersion,
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
} from "@langwatch/trace-contract";
import { z } from "zod";

import {
  TraceSummaryProjectionRepository,
  type TraceSummaryProjectionEntry,
  type TraceSummaryReadWindow,
} from "../trace-summary-projection.repository.ts";
import type {
  FindByTraceIdOptions,
  FindByTraceIdParams,
  TraceSummaryRead,
  TraceSummaryRepository,
} from "../trace-summary.repository.ts";
import type { TraceClickHouseWriteResolver } from "./clickhouse.trace-member-client.repository.ts";
import { chBoolean, chNumber, chString, chStringMap } from "./stored-span-row.mapper.ts";
import { createTraceSummaryProjectionId } from "./trace-summary-id.mapper.ts";

/**
 * Fields shared between trace summary and list repositories from trace_summaries.
 */
interface TraceSummaryFieldsBase {
  TraceId: string;
  TenantId: string;
  OccurredAt: number;
  CreatedAt: number;
  UpdatedAt: number;
  ComputedIOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TotalDurationMs: number;
  TokensPerSecond: number | null;
  SpanCount: number;
  ContainsErrorStatus: number;
  ContainsOKStatus: number;
  ErrorMessage: string | null;
  Models: string[];
  TotalCost: number | null;
  NonBilledCost: number | null;
  TokensEstimated: boolean;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  OutputFromRootSpan: number;
  OutputSpanEndTimeMs: number;
  BlockedByGuardrail: number;
  RootSpanType: string | null;
  ContainsAi: number;
  TraceName: string;
  ContainsPrompt: number;
  SelectedPromptId: string | null;
  SelectedPromptSpanId: string | null;
  LastUsedPromptId: string | null;
  LastUsedPromptVersionNumber: number | null;
  LastUsedPromptVersionId: string | null;
  LastUsedPromptSpanId: string | null;
  TopicId: string | null;
  SubTopicId: string | null;
  AnnotationIds: string[];
  /**
   * Stored payload size in bytes — the MATERIALIZED `_size_bytes` column
   * (migration 00032). SELECT-only, never written in INSERTs; optional
   * because only the list read path projects it.
   */
  SizeBytes?: number;
}

const TABLE_NAME = "trace_summaries" as const;

const logger = createLogger("langwatch:trace:trace-summary-repository");

function validateBatchTenants<T extends { tenantId: string }>(
  entries: readonly T[],
  context: string,
): string {
  const tenantId = entries[0]?.tenantId;
  if (!tenantId) {
    throw new Error(`${context}: cannot validate tenants on an empty batch`);
  }

  EventUtils.validateTenantId({ tenantId }, context);
  const mismatchedTenant = entries.find((entry) => entry.tenantId !== tenantId);
  if (mismatchedTenant) {
    throw new Error(
      `Mixed tenants in ${context}: expected ${tenantId}, got ${mismatchedTenant.tenantId}`,
    );
  }

  return tenantId;
}

type ClickHouseSummaryWriteRecord = Omit<
  ClickHouseSummaryRecord,
  "OccurredAt" | "CreatedAt" | "UpdatedAt" | "LastEventOccurredAt"
> & {
  OccurredAt: Date;
  CreatedAt: Date;
  UpdatedAt: Date;
  LastEventOccurredAt: Date;
};

/**
 * OccurredAt partition value with fallback chain; validated on every write.
 */
function storageAnchorForWrite(data: TraceSummaryData): number {
  return firstUsableAnchor({
    candidates: [data.storageAnchorMs, data.createdAt],
    now: nowInstant().epochMilliseconds,
  });
}

interface ClickHouseSummaryRecord extends TraceSummaryFieldsBase {
  ProjectionId: string;
  Version: string;
  Attributes: Record<string, string>;
  HasAnnotation: number | null;
  LastEventOccurredAt: number;
  /**
   * The span timing baseline, epoch ms (migration 00072): earliest
   * non-synthetic-span start, 0 until folded. `OccurredAt` used to carry
   * this too; ADR-087 split them. Absent pre-00072 (version gate handles it).
   */
  EarliestSpanStartMs?: number | string;
  _retention_days: number;
}

/** One `findByTraceId` row, as ClickHouse's JSON writes the columns that read selects. */
const summaryReadRowSchema = z.looseObject({
  ProjectionId: chString,
  TenantId: chString,
  TraceId: chString,
  Version: chString,
  Attributes: chStringMap,
  OccurredAt: chNumber,
  EarliestSpanStartMs: chNumber.optional(),
  CreatedAt: chNumber,
  UpdatedAt: chNumber,
  LastEventOccurredAt: chNumber.optional(),
  ComputedIOSchemaVersion: chString,
  ComputedInput: chString.nullable(),
  ComputedOutput: chString.nullable(),
  TimeToFirstTokenMs: chNumber.nullable(),
  TimeToLastTokenMs: chNumber.nullable(),
  TotalDurationMs: chNumber,
  TokensPerSecond: chNumber.nullable(),
  SpanCount: chNumber,
  ContainsErrorStatus: chBoolean,
  ContainsOKStatus: chBoolean,
  ErrorMessage: chString.nullable(),
  Models: z.array(chString),
  TotalCost: chNumber.nullable(),
  NonBilledCost: chNumber.nullable(),
  TokensEstimated: chBoolean,
  TotalPromptTokenCount: chNumber.nullable(),
  TotalCompletionTokenCount: chNumber.nullable(),
  OutputFromRootSpan: chBoolean,
  OutputSpanEndTimeMs: chNumber,
  BlockedByGuardrail: chBoolean,
  RootSpanType: chString.nullable(),
  ContainsAi: chBoolean,
  ContainsPrompt: chBoolean,
  SelectedPromptId: chString.nullable(),
  SelectedPromptSpanId: chString.nullable(),
  LastUsedPromptId: chString.nullable(),
  LastUsedPromptVersionNumber: chNumber.nullable(),
  LastUsedPromptVersionId: chString.nullable(),
  LastUsedPromptSpanId: chString.nullable(),
  TopicId: chString.nullable(),
  SubTopicId: chString.nullable(),
  AnnotationIds: z.array(chString),
  HasAnnotation: chBoolean.nullable(),
  TraceName: chString,
});

const summaryReadRowsSchema = z.array(summaryReadRowSchema);

type SummaryReadRow = z.infer<typeof summaryReadRowSchema>;

const tenantIdRowsSchema = z.array(z.looseObject({ TenantId: chString }));

const occurredAtCountRowsSchema = z.array(
  z.looseObject({ rowCount: chNumber, occurredAtMs: chNumber.nullable() }),
);

/** A failed summary read, logged with the fence it ran under. */
function logSummaryReadFailure({
  authorization,
  traceId,
  error,
}: {
  authorization: Authorization;
  traceId: string;
  error: unknown;
}): void {
  logger.warn(
    {
      traceId,
      scope: tenantScopeKey({ authorization, reads: "traces" }),
      error: error instanceof Error ? error.message : String(error),
    },
    "Failed to get trace summary from ClickHouse",
  );
}

export class TraceSummaryClickHouseRepository implements TraceSummaryRepository {
  /** Writes resolve the tenant's own client; reads go through the proof's fence (ADR-177). */
  private constructor(
    private readonly options: {
      resolveClient: TraceClickHouseWriteResolver;
      clickhouse: AuthorizedClickHouse;
    },
  ) {}

  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
    clickhouse: AuthorizedClickHouse;
  }): TraceSummaryClickHouseRepository {
    return new TraceSummaryClickHouseRepository(options);
  }

  private reader(authorization: Authorization): TenantScopedReader {
    return this.options.clickhouse.as(authorization, { reads: "traces" });
  }

  async upsert(data: TraceSummaryData, tenantId: string, retentionDays: number): Promise<void> {
    EventUtils.validateTenantId({ tenantId }, "TraceSummaryClickHouseRepository.upsert");

    const projectionId = createTraceSummaryProjectionId({
      tenantId,
      traceId: data.traceId,
      occurredAtMs: data.occurredAt,
    });

    try {
      const client = await this.options.resolveClient(tenantId);
      const record = this.toClickHouseRecord({
        data,
        tenantId,
        projectionId,
        version: TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
        retentionDays,
      });

      await client.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        { tenantId, traceId: data.traceId, error: errorMessage },
        "Failed to store trace summary in ClickHouse",
      );
      throw error;
    }
  }

  async upsertBatch(
    entries: {
      data: TraceSummaryData;
      tenantId: string;
      retentionDays: number;
    }[],
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = validateBatchTenants(entries, "TraceSummaryClickHouseRepository.upsertBatch");

    try {
      const client = await this.options.resolveClient(tenantId);
      const records = entries.map(({ data, tenantId: tid, retentionDays: rd }) => {
        const projectionId = createTraceSummaryProjectionId({
          tenantId: tid,
          traceId: data.traceId,
          occurredAtMs: data.occurredAt,
        });
        return this.toClickHouseRecord({
          data,
          tenantId: tid,
          projectionId,
          version: TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
          retentionDays: rd,
        });
      });

      await client.insert({
        table: TABLE_NAME,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        { tenantId, count: entries.length, error: errorMessage },
        "Failed to batch store trace summaries in ClickHouse",
      );
      throw error;
    }
  }

  /**
   * Fold read-back path (ADR-066): an explicit window applies verbatim with
   * NO internal fallback — the fold executor owns the miss retry, so a
   * second recovery ladder here would re-run a seek the executor redoes anyway.
   */
  async #findInExplicitWindow({
    authorization,
    traceId,
    window: { fromMs, toMs },
  }: {
    authorization: Authorization;
    traceId: string;
    window: { fromMs: number; toMs: number };
  }): Promise<TraceSummaryRead | null> {
    try {
      return await queryWindowed<TraceSummaryRead | null>({
        table: TABLE_NAME,
        hintMs: (fromMs + toMs) / 2,
        windowMs: (toMs - fromMs) / 2,
        fallback: "none",
        isEmpty: (result) => result === null,
        run: async (window) =>
          // With a hint and `fallback: "none"` the fragment is always
          // present; the null arm exists only to satisfy the contract.
          window
            ? this.queryByTraceId({
                authorization,
                traceId,
                window: { fromMs: window.fromMs, toMs: window.toMs },
              })
            : null,
      });
    } catch (error) {
      logSummaryReadFailure({ authorization, traceId, error });
      throw error;
    }
  }

  /**
   * The fallback stage: the hint window missed, or there was none. Resolves
   * OccurredAt from a cheap sort-key seek and bounds the heavy read instead
   * of scanning every weekly partition. A genuinely absent trace returns null.
   */
  async #findByResolvedOccurredAt({
    authorization,
    traceId,
    hasHint,
    options,
  }: {
    authorization: Authorization;
    traceId: string;
    hasHint: boolean;
    options: FindByTraceIdOptions;
  }): Promise<TraceSummaryRead | null> {
    if (hasHint) {
      logger.debug(
        { traceId, occurredAtMs: options.occurredAtMs },
        "Trace summary not found in hint window — resolving OccurredAt to bound the retry",
      );
    }

    const resolved = await this.resolveOccurredAtMs({ authorization, traceId });
    if (!resolved.found) return null;

    if (resolved.occurredAtMs === undefined) {
      logger.debug(
        { traceId },
        "Trace summary resolved with sentinel OccurredAt — falling back to unbounded read",
      );

      return this.queryByTraceId({ authorization, traceId });
    }

    return this.queryByTraceId({
      authorization,
      traceId,
      window: {
        fromMs: resolved.occurredAtMs - DEFAULT_PARTITION_WINDOW_MS,
        toMs: resolved.occurredAtMs + DEFAULT_PARTITION_WINDOW_MS,
      },
    });
  }

  async findByTraceId({
    authorization,
    traceId,
    ...options
  }: FindByTraceIdParams): Promise<TraceSummaryRead | null> {
    // Fold read-back path (ADR-066): an explicit window applies verbatim
    // with NO internal fallback — the fold executor owns the miss retry, so
    // a second recovery ladder here would re-run a seek it redoes anyway.
    if (options.window) {
      return this.#findInExplicitWindow({ authorization, traceId, window: options.window });
    }

    // Two-stage read: hinted window for partition pruning, fallback unbounded.
    const hasHint = options.occurredAtMs !== undefined;

    try {
      return await queryWindowed<TraceSummaryRead | null>({
        table: TABLE_NAME,
        hintMs: options.occurredAtMs ?? null,
        fallback: "unbounded",
        isEmpty: (result) => result === null,
        run: async (window) => {
          if (window) {
            return this.queryByTraceId({
              authorization,
              traceId,
              window: { fromMs: window.fromMs, toMs: window.toMs },
            });
          }

          return this.#findByResolvedOccurredAt({ authorization, traceId, hasHint, options });
        },
      });
    } catch (error) {
      logSummaryReadFailure({ authorization, traceId, error });
      throw error;
    }
  }

  /**
   * The tenants holding a trace, of those the proof reads, ordered by tenant
   * id: the first is the row {@link queryByTraceId} returns. A sort-key seek
   * over one small column, for a caller that needs only whose trace it is.
   */
  async findTenantIdsByTraceId({
    authorization,
    traceId,
  }: {
    authorization: Authorization;
    traceId: string;
  }): Promise<string[]> {
    try {
      const result = await this.reader(authorization).query({
        query: `
          SELECT DISTINCT TenantId
          FROM ${TABLE_NAME}
          WHERE ${tenantScope("OccurredAt")}
            AND TraceId = {traceId:String}
          ORDER BY TenantId
        `,
        query_params: { traceId },
        format: "JSONEachRow",
      });
      return tenantIdRowsSchema.parse(await result.json()).map((row) => row.TenantId);
    } catch (error) {
      logger.warn(
        {
          traceId,
          scope: tenantScopeKey({ authorization, reads: "traces" }),
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to resolve the tenant of a trace from ClickHouse",
      );
      throw error;
    }
  }

  /**
   * Resolves OccurredAt via sort-key seek to enable partition pruning.
   */
  private async resolveOccurredAtMs({
    authorization,
    traceId,
  }: {
    authorization: Authorization;
    traceId: string;
  }): Promise<{ found: boolean; occurredAtMs?: number }> {
    const result = await this.reader(authorization).query({
      query: `
        SELECT
          count() AS rowCount,
          toUnixTimestamp64Milli(min(OccurredAt)) AS occurredAtMs
        FROM ${TABLE_NAME}
        WHERE ${tenantScope("OccurredAt")}
          AND TraceId = {traceId:String}
      `,
      query_params: { traceId },
      format: "JSONEachRow",
    });
    const rows = occurredAtCountRowsSchema.parse(await result.json());
    const rowCountRaw = rows[0]?.rowCount;
    const raw = rows[0]?.occurredAtMs;
    const rowCount = typeof rowCountRaw === "string" ? Number(rowCountRaw) : (rowCountRaw ?? NaN);
    if (!Number.isFinite(rowCount) || rowCount <= 0) {
      return { found: false };
    }
    if (raw === null || raw === undefined) return { found: true };
    // A positive OccurredAt can safely bound the read. Historical rows with the
    // epoch sentinel (0) must fall back to the legacy unbounded lookup because
    // they do exist but have no usable partition key.
    const ms = typeof raw === "string" ? Number(raw) : raw;
    return Number.isFinite(ms) && ms > 0 ? { found: true, occurredAtMs: ms } : { found: true };
  }

  /**
   * The heavy single-trace read. The fence is the only tenant predicate; two
   * members may hold the same trace id (ADR-177), so the winners are ordered
   * by tenant and the first is returned, the same row on every read.
   */
  private async queryByTraceId({
    authorization,
    traceId,
    window,
  }: {
    authorization: Authorization;
    traceId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<TraceSummaryRead | null> {
    const outerTimeFilter = window
      ? "AND t.OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64}) " +
        "AND t.OccurredAt <= fromUnixTimestamp64Milli({toMs:Int64})"
      : "";
    const innerTimeFilter = window
      ? "AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64}) " +
        "AND OccurredAt <= fromUnixTimestamp64Milli({toMs:Int64})"
      : "";

    const client = this.reader(authorization);
    // IN-tuple dedup over the ReplacingMergeTree: the inner SELECT scans
    // only (TenantId, TraceId, UpdatedAt) — small, sparse — to find the
    // latest version, then the outer SELECT pulls the heavy columns
    // (ComputedInput, ComputedOutput, Attributes, etc.) for that one row.
    // See dev/docs/best_practices/clickhouse-queries.md.

    // The windowed fence sits in the inner SELECT only: the outer `OccurredAt`
    // is the projected integer, compared against a DateTime64 bound as seconds.
    const result = await client.query({
      query: `
        SELECT
          t.ProjectionId AS ProjectionId,
          t.TenantId AS TenantId,
          t.TraceId AS TraceId,
          t.Version AS Version,
          t.Attributes AS Attributes,
          toUnixTimestamp64Milli(t.OccurredAt) AS OccurredAt,
          t.EarliestSpanStartMs AS EarliestSpanStartMs,
          toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
          toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
          t.ComputedIOSchemaVersion AS ComputedIOSchemaVersion,
          t.ComputedInput AS ComputedInput,
          t.ComputedOutput AS ComputedOutput,
          t.TimeToFirstTokenMs AS TimeToFirstTokenMs,
          t.TimeToLastTokenMs AS TimeToLastTokenMs,
          t.TotalDurationMs AS TotalDurationMs,
          t.TokensPerSecond AS TokensPerSecond,
          t.SpanCount AS SpanCount,
          t.ContainsErrorStatus AS ContainsErrorStatus,
          t.ContainsOKStatus AS ContainsOKStatus,
          t.ErrorMessage AS ErrorMessage,
          t.Models AS Models,
          t.TotalCost AS TotalCost,
          t.NonBilledCost AS NonBilledCost,
          t.TokensEstimated AS TokensEstimated,
          t.TotalPromptTokenCount AS TotalPromptTokenCount,
          t.TotalCompletionTokenCount AS TotalCompletionTokenCount,
          t.OutputFromRootSpan AS OutputFromRootSpan,
          t.OutputSpanEndTimeMs AS OutputSpanEndTimeMs,
          t.BlockedByGuardrail AS BlockedByGuardrail,
          t.RootSpanType AS RootSpanType,
          t.ContainsAi AS ContainsAi,
          t.ContainsPrompt AS ContainsPrompt,
          t.SelectedPromptId AS SelectedPromptId,
          t.SelectedPromptSpanId AS SelectedPromptSpanId,
          t.LastUsedPromptId AS LastUsedPromptId,
          t.LastUsedPromptVersionNumber AS LastUsedPromptVersionNumber,
          t.LastUsedPromptVersionId AS LastUsedPromptVersionId,
          t.LastUsedPromptSpanId AS LastUsedPromptSpanId,
          t.TopicId AS TopicId,
          t.SubTopicId AS SubTopicId,
          t.AnnotationIds AS AnnotationIds,
          t.HasAnnotation AS HasAnnotation,
          t.TraceName AS TraceName
        FROM ${TABLE_NAME} AS t
        WHERE ${tenantSet()}
          AND t.TraceId = {traceId:String}
          ${outerTimeFilter}
          AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE ${tenantScope("OccurredAt")}
              AND TraceId = {traceId:String}
              ${innerTimeFilter}
            GROUP BY TenantId, TraceId
          )
        ORDER BY t.TenantId ASC
        LIMIT 1
      `,
      query_params: window ? { traceId, fromMs: window.fromMs, toMs: window.toMs } : { traceId },
      format: "JSONEachRow",
    });

    const rows = summaryReadRowsSchema.parse(await result.json());
    const row = rows[0];
    if (!row) return null;
    return { ...this.fromClickHouseRecord(row), tenantId: row.TenantId };
  }

  private fromClickHouseRecord(record: SummaryReadRow): TraceSummaryData {
    return {
      traceId: record.TraceId,
      spanCount: record.SpanCount,
      totalDurationMs: Number(record.TotalDurationMs),
      computedIOSchemaVersion: record.ComputedIOSchemaVersion,
      computedInput: record.ComputedInput,
      computedOutput: record.ComputedOutput,
      timeToFirstTokenMs: record.TimeToFirstTokenMs,
      timeToLastTokenMs: record.TimeToLastTokenMs,
      tokensPerSecond: record.TokensPerSecond,
      containsErrorStatus: !!record.ContainsErrorStatus,
      containsOKStatus: !!record.ContainsOKStatus,
      errorMessage: record.ErrorMessage,
      models: record.Models,
      totalCost: record.TotalCost,
      nonBilledCost: record.NonBilledCost ?? null,
      tokensEstimated: !!record.TokensEstimated,
      totalPromptTokenCount: record.TotalPromptTokenCount,
      totalCompletionTokenCount: record.TotalCompletionTokenCount,
      outputFromRootSpan: !!record.OutputFromRootSpan,
      outputSpanEndTimeMs: Number(record.OutputSpanEndTimeMs),
      blockedByGuardrail: !!record.BlockedByGuardrail,
      rootSpanType: record.RootSpanType,
      containsAi: !!record.ContainsAi,
      containsPrompt: !!record.ContainsPrompt,
      selectedPromptId: record.SelectedPromptId,
      selectedPromptSpanId: record.SelectedPromptSpanId,
      // Internal tiebreakers are not persisted; reconstruct as null on read.
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: record.LastUsedPromptId,
      lastUsedPromptVersionNumber: record.LastUsedPromptVersionNumber,
      lastUsedPromptVersionId: record.LastUsedPromptVersionId,
      lastUsedPromptSpanId: record.LastUsedPromptSpanId,
      lastUsedPromptStartTimeMs: null,
      topicId: record.TopicId,
      subTopicId: record.SubTopicId,
      annotationIds: record.AnnotationIds ?? [],
      traceName: record.TraceName ?? "",
      attributes: record.Attributes ?? {},
      // Anchor is frozen; occurrence time from separate column for span baseline.
      storageAnchorMs: record.OccurredAt,
      occurredAt: isStorageAnchoredVersion(record.Version)
        ? Number(record.EarliestSpanStartMs ?? 0)
        : record.OccurredAt,
      createdAt: record.CreatedAt,
      updatedAt: record.UpdatedAt,
      LastEventOccurredAt: Number(record.LastEventOccurredAt ?? 0),
    };
  }

  private toClickHouseRecord({
    data,
    tenantId,
    projectionId,
    version,
    retentionDays,
  }: {
    data: TraceSummaryData;
    tenantId: string;
    projectionId: string;
    version: string;
    retentionDays: number;
  }): ClickHouseSummaryWriteRecord {
    return {
      ProjectionId: projectionId,
      TenantId: tenantId,
      TraceId: data.traceId,
      Version: version,
      Attributes: data.attributes,
      // OccurredAt is the storage / partition / TTL anchor (ADR-087). The span
      // timing baseline is persisted separately so a late earlier-starting span
      // cannot move this address.
      OccurredAt: new Date(storageAnchorForWrite(data)),
      EarliestSpanStartMs: data.occurredAt,
      CreatedAt: new Date(data.createdAt),
      UpdatedAt: new Date(data.updatedAt),
      LastEventOccurredAt: data.LastEventOccurredAt
        ? new Date(data.LastEventOccurredAt)
        : new Date(0),
      ComputedIOSchemaVersion: data.computedIOSchemaVersion,
      ComputedInput: data.computedInput,
      ComputedOutput: data.computedOutput,
      TimeToFirstTokenMs:
        data.timeToFirstTokenMs != null ? Math.round(data.timeToFirstTokenMs) : null,
      TimeToLastTokenMs: data.timeToLastTokenMs != null ? Math.round(data.timeToLastTokenMs) : null,
      TotalDurationMs: Math.round(data.totalDurationMs),
      TokensPerSecond: data.tokensPerSecond != null ? Math.round(data.tokensPerSecond) : null,
      SpanCount: data.spanCount,
      ContainsErrorStatus: data.containsErrorStatus ? 1 : 0,
      ContainsOKStatus: data.containsOKStatus ? 1 : 0,
      ErrorMessage: data.errorMessage,
      Models: data.models,
      TotalCost: data.totalCost,
      NonBilledCost: data.nonBilledCost,
      TokensEstimated: data.tokensEstimated,
      TotalPromptTokenCount: data.totalPromptTokenCount,
      TotalCompletionTokenCount: data.totalCompletionTokenCount,
      OutputFromRootSpan: data.outputFromRootSpan ? 1 : 0,
      OutputSpanEndTimeMs: data.outputSpanEndTimeMs,
      BlockedByGuardrail: data.blockedByGuardrail ? 1 : 0,
      RootSpanType: data.rootSpanType,
      ContainsAi: data.containsAi ? 1 : 0,
      ContainsPrompt: data.containsPrompt ? 1 : 0,
      SelectedPromptId: data.selectedPromptId,
      SelectedPromptSpanId: data.selectedPromptSpanId,
      LastUsedPromptId: data.lastUsedPromptId,
      LastUsedPromptVersionNumber: data.lastUsedPromptVersionNumber,
      LastUsedPromptVersionId: data.lastUsedPromptVersionId,
      LastUsedPromptSpanId: data.lastUsedPromptSpanId,
      TopicId: data.topicId,
      SubTopicId: data.subTopicId,
      AnnotationIds: data.annotationIds,
      HasAnnotation: data.annotationIds.length > 0 ? 1 : 0,
      TraceName: data.traceName,
      _retention_days: retentionDays,
    };
  }
}

/**
 * The trace_summaries projection port over the same ClickHouse repository
 * the read side uses — same table, key triple and partition column. Only
 * the fold's write argument shape differs, reshaped here, not at composition.
 */
export class TraceSummaryProjectionClickHouseRepository extends TraceSummaryProjectionRepository {
  private constructor(private readonly repository: TraceSummaryClickHouseRepository) {
    super();
  }

  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
    clickhouse: AuthorizedClickHouse;
  }): TraceSummaryProjectionClickHouseRepository {
    return new TraceSummaryProjectionClickHouseRepository(
      TraceSummaryClickHouseRepository.create(options),
    );
  }

  async upsert(entry: TraceSummaryProjectionEntry): Promise<void> {
    await this.repository.upsert(entry.data, entry.tenantId, entry.retentionDays);
  }

  override async upsertBatch(entries: TraceSummaryProjectionEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.repository.upsertBatch(entries);
  }

  async findByTraceId(input: {
    authorization: Authorization;
    traceId: string;
    window?: TraceSummaryReadWindow;
  }): Promise<TraceSummaryData | null> {
    return this.repository.findByTraceId(input);
  }
}
