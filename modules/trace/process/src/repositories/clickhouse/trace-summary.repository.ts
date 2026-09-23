import { DEFAULT_PARTITION_WINDOW_MS, queryWindowed } from "@langwatch/clickhouse-client";
import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  isStorageAnchoredVersion,
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
} from "@langwatch/trace-contract";

import { firstUsableAnchor } from "../../rules/trace-storage-anchor.rules.ts";
import {
  TraceSummaryProjectionRepository,
  type TraceSummaryProjectionEntry,
  type TraceSummaryReadWindow,
} from "../projection/trace-summary-projection.repository.ts";
import type { TraceClickHouseWriteResolver } from "../trace-clickhouse-client.repository.ts";
import type { FindByTraceIdOptions, TraceSummaryRepository } from "../trace-summary.repository.ts";
import { createTraceSummaryProjectionId } from "./trace-summary-id.mapper.ts";

/**
 * Fields shared between trace summary and list repositories from trace_summaries.
 */
export interface TraceSummaryFieldsBase {
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

export class TraceSummaryClickHouseRepository implements TraceSummaryRepository {
  private constructor(
    private readonly options: {
      resolveClient: TraceClickHouseWriteResolver;
      defaultRetentionDays: number;
    },
  ) {}

  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
    defaultRetentionDays: number;
  }): TraceSummaryClickHouseRepository {
    return new TraceSummaryClickHouseRepository(options);
  }

  async upsert(
    data: TraceSummaryData,
    tenantId: string,
    retentionDays = this.options.defaultRetentionDays,
  ): Promise<void> {
    EventUtils.validateTenantId({ tenantId }, "TraceSummaryClickHouseRepository.upsert");

    const projectionId = createTraceSummaryProjectionId({
      tenantId,
      traceId: data.traceId,
      occurredAtMs: data.occurredAt,
    });

    try {
      const client = await this.options.resolveClient(tenantId);
      const record = this.toClickHouseRecord(
        data,
        tenantId,
        projectionId,
        TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
        retentionDays,
      );

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
      retentionDays?: number;
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
        return this.toClickHouseRecord(
          data,
          tid,
          projectionId,
          TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
          rd,
        );
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
    tenantId,
    traceId,
    window: { fromMs, toMs },
  }: {
    tenantId: string;
    traceId: string;
    window: { fromMs: number; toMs: number };
  }): Promise<TraceSummaryData | null> {
    try {
      return await queryWindowed<TraceSummaryData | null>({
        table: TABLE_NAME,
        hintMs: (fromMs + toMs) / 2,
        windowMs: (toMs - fromMs) / 2,
        fallback: "none",
        isEmpty: (result) => result === null,
        run: async (window) =>
          // With a hint and `fallback: "none"` the fragment is always
          // present; the null arm exists only to satisfy the contract.
          window
            ? this.queryByTraceId(tenantId, traceId, {
                fromMs: window.fromMs,
                toMs: window.toMs,
              })
            : null,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        { tenantId, traceId, error: errorMessage },
        "Failed to get trace summary from ClickHouse",
      );
      throw error;
    }
  }

  /**
   * The fallback stage: the hint window missed, or there was none. Resolves
   * OccurredAt from a cheap sort-key seek and bounds the heavy read instead
   * of scanning every weekly partition. A genuinely absent trace returns null.
   */
  async #findByResolvedOccurredAt({
    tenantId,
    traceId,
    hasHint,
    options,
  }: {
    tenantId: string;
    traceId: string;
    hasHint: boolean;
    options?: FindByTraceIdOptions;
  }): Promise<TraceSummaryData | null> {
    if (hasHint) {
      logger.debug(
        { tenantId, traceId, occurredAtMs: options!.occurredAtMs },
        "Trace summary not found in hint window — resolving OccurredAt to bound the retry",
      );
    }

    const resolved = await this.resolveOccurredAtMs({ tenantId, traceId });
    if (!resolved.found) return null;

    if (resolved.occurredAtMs === undefined) {
      logger.debug(
        { tenantId, traceId },
        "Trace summary resolved with sentinel OccurredAt — falling back to unbounded read",
      );

      return this.queryByTraceId(tenantId, traceId);
    }

    return this.queryByTraceId(tenantId, traceId, {
      fromMs: resolved.occurredAtMs - DEFAULT_PARTITION_WINDOW_MS,
      toMs: resolved.occurredAtMs + DEFAULT_PARTITION_WINDOW_MS,
    });
  }

  async findByTraceId(
    { tenantId, traceId }: { tenantId: string; traceId: string },
    options?: FindByTraceIdOptions,
  ): Promise<TraceSummaryData | null> {
    EventUtils.validateTenantId({ tenantId }, "TraceSummaryClickHouseRepository.findByTraceId");

    // Fold read-back path (ADR-066): an explicit window applies verbatim
    // with NO internal fallback — the fold executor owns the miss retry, so
    // a second recovery ladder here would re-run a seek it redoes anyway.
    if (options?.window) {
      return this.#findInExplicitWindow({ tenantId, traceId, window: options.window });
    }

    // Two-stage read: hinted window for partition pruning, fallback unbounded.
    const hasHint = options?.occurredAtMs !== undefined;

    try {
      return await queryWindowed<TraceSummaryData | null>({
        table: TABLE_NAME,
        hintMs: options?.occurredAtMs ?? null,
        fallback: "unbounded",
        isEmpty: (result) => result === null,
        run: async (window) => {
          if (window) {
            return this.queryByTraceId(tenantId, traceId, {
              fromMs: window.fromMs,
              toMs: window.toMs,
            });
          }

          return this.#findByResolvedOccurredAt({ tenantId, traceId, hasHint, options });
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        { tenantId, traceId, error: errorMessage },
        "Failed to get trace summary from ClickHouse",
      );
      throw error;
    }
  }

  /**
   * Resolves OccurredAt via sort-key seek to enable partition pruning.
   */
  private async resolveOccurredAtMs({
    tenantId,
    traceId,
  }: {
    tenantId: string;
    traceId: string;
  }): Promise<{ found: boolean; occurredAtMs?: number }> {
    const client = await this.options.resolveClient(tenantId);
    const result = await client.query({
      query: `
        SELECT
          count() AS rowCount,
          toUnixTimestamp64Milli(min(OccurredAt)) AS occurredAtMs
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND TraceId = {traceId:String}
      `,
      query_params: { tenantId, traceId },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as {
      rowCount: string | number;
      occurredAtMs: string | number | null;
    }[];
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

  private async queryByTraceId(
    tenantId: string,
    traceId: string,
    window?: { fromMs: number; toMs: number },
  ): Promise<TraceSummaryData | null> {
    const outerTimeFilter = window
      ? "AND t.OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64}) " +
        "AND t.OccurredAt <= fromUnixTimestamp64Milli({toMs:Int64})"
      : "";
    const innerTimeFilter = window
      ? "AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64}) " +
        "AND OccurredAt <= fromUnixTimestamp64Milli({toMs:Int64})"
      : "";

    const client = await this.options.resolveClient(tenantId);
    // IN-tuple dedup over the ReplacingMergeTree: the inner SELECT scans
    // only (TenantId, TraceId, UpdatedAt) — small, sparse — to find the
    // latest version, then the outer SELECT pulls the heavy columns
    // (ComputedInput, ComputedOutput, Attributes, etc.) for that one row.
    // See dev/docs/best_practices/clickhouse-queries.md.
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
        WHERE t.TenantId = {tenantId:String}
          AND t.TraceId = {traceId:String}
          ${outerTimeFilter}
          AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
              ${innerTimeFilter}
            GROUP BY TenantId, TraceId
          )
        LIMIT 1
      `,
      query_params: window
        ? { tenantId, traceId, fromMs: window.fromMs, toMs: window.toMs }
        : { tenantId, traceId },
      format: "JSONEachRow",
    });

    const rows = await result.json<ClickHouseSummaryRecord>();
    const row = rows[0];
    if (!row) return null;
    return this.fromClickHouseRecord(row);
  }

  private fromClickHouseRecord(record: ClickHouseSummaryRecord): TraceSummaryData {
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

  private toClickHouseRecord(
    data: TraceSummaryData,
    tenantId: string,
    projectionId: string,
    version: string,
    retentionDays = this.options.defaultRetentionDays,
  ): ClickHouseSummaryWriteRecord {
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
    defaultRetentionDays: number;
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
    tenantId: string;
    traceId: string;
    window?: TraceSummaryReadWindow;
  }): Promise<TraceSummaryData | null> {
    return this.repository.findByTraceId(
      { tenantId: input.tenantId, traceId: input.traceId },
      { window: input.window },
    );
  }
}
