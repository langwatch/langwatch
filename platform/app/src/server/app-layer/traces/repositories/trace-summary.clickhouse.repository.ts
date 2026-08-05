import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { WithDateWrites } from "~/server/clickhouse/types";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import { firstUsableAnchor } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/storage-anchor";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import { IdUtils } from "~/server/event-sourcing/pipelines/trace-processing/utils/id.utils";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { validateBatchTenants } from "../../_shared/clickhouse-batch";
import {
  DEFAULT_PARTITION_WINDOW_MS,
  queryWindowed,
} from "../../clients/clickhouse/windowed-read";
import type { TraceSummaryData } from "../types";
import type { TraceSummaryFieldsBase } from "./_summary-fields.types";
import type {
  FindByTraceIdOptions,
  TraceSummaryRepository,
} from "./trace-summary.repository";

const TABLE_NAME = "trace_summaries" as const;

const logger = createLogger(
  "langwatch:app-layer:traces:trace-summary-repository",
);

type ClickHouseSummaryWriteRecord = WithDateWrites<
  ClickHouseSummaryRecord,
  "OccurredAt" | "CreatedAt" | "UpdatedAt" | "LastEventOccurredAt"
>;

/**
 * The value that lands in the `OccurredAt` partition / TTL column (ADR-087).
 *
 * The fallback chain is a last resort for a state nothing could anchor: one
 * whose every event carried a zero `occurredAt` (the event schema permits it —
 * `nonnegative`, not `positive`), or whose only candidate times were implausibly
 * far in the future. It exists so the partition column can never be the epoch,
 * and each step is validated rather than trusted — `parseClickHouseDateTimeMs`
 * returns 0 on a parse failure, so an unchecked `createdAt` would put the row
 * straight back in 196952, the one outcome this change exists to prevent.
 *
 * ADR-071 names `CreatedAt` as a trap for exactly this use, and it is right: it
 * is fold time, so a rebuild re-stamps it. Accepted here on the same terms
 * `trace_analytics` accepted it — it applies ONLY to a state with no business
 * time at all, and the read-back promotes whatever landed in the column to the
 * frozen anchor, so it stops drifting after the first write.
 *
 * `now` is read here rather than passed because the anchor is validated on every
 * write, not only when first frozen: a row whose committed anchor is more than a
 * day ahead of fold time fails the bound and is rewritten at fold time. That is
 * the one case where an already-committed row changes partition, and it is
 * deliberate.
 */
function storageAnchorForWrite(data: TraceSummaryData): number {
  return firstUsableAnchor([data.storageAnchorMs, data.createdAt], Date.now());
}

interface ClickHouseSummaryRecord extends TraceSummaryFieldsBase {
  ProjectionId: string;
  Version: string;
  Attributes: Record<string, string>;
  HasAnnotation: number | null;
  LastEventOccurredAt: number;
  /**
   * The span timing baseline, epoch ms (migration 00072): the earliest start
   * across the trace's non-synthetic spans, 0 while none has been folded.
   * `OccurredAt` used to carry this as well as the storage anchor; ADR-087 split
   * them. Absent on rows written before 00072, which the version gate in
   * {@link TraceSummaryClickHouseRepository.fromClickHouseRecord} handles.
   */
  EarliestSpanStartMs?: number | string;
  _retention_days: number;
}

export class TraceSummaryClickHouseRepository
  implements TraceSummaryRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async upsert(
    data: TraceSummaryData,
    tenantId: string,
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId },
      "TraceSummaryClickHouseRepository.upsert",
    );

    const projectionId = IdUtils.generateDeterministicTraceSummaryIdFromData(
      tenantId,
      data.traceId,
      data.occurredAt,
    );

    try {
      const client = await this.resolveClient(tenantId);
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, traceId: data.traceId, error: errorMessage },
        "Failed to store trace summary in ClickHouse",
      );
      throw error;
    }
  }

  async upsertBatch(
    entries: Array<{
      data: TraceSummaryData;
      tenantId: string;
      retentionDays?: number;
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = validateBatchTenants(
      entries,
      "TraceSummaryClickHouseRepository.upsertBatch",
    );

    try {
      const client = await this.resolveClient(tenantId);
      const records = entries.map(
        ({ data, tenantId: tid, retentionDays: rd }) => {
          const projectionId =
            IdUtils.generateDeterministicTraceSummaryIdFromData(
              tid,
              data.traceId,
              data.occurredAt,
            );
          return this.toClickHouseRecord(
            data,
            tid,
            projectionId,
            TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
            rd,
          );
        },
      );

      await client.insert({
        table: TABLE_NAME,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, count: entries.length, error: errorMessage },
        "Failed to batch store trace summaries in ClickHouse",
      );
      throw error;
    }
  }

  async findByTraceId(
    tenantId: string,
    traceId: string,
    options?: FindByTraceIdOptions,
  ): Promise<TraceSummaryData | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "TraceSummaryClickHouseRepository.findByTraceId",
    );

    // Fold read-back path (ADR-066): an explicit window is applied verbatim
    // with NO internal fallback — the caller (the fold executor) owns the miss
    // retry, so a second recovery ladder here would re-run the resolve seek on
    // results the executor is about to re-read unwindowed anyway. Mapped onto
    // queryWindowed with `fallback: "none"` so the read still lands on
    // `clickhouse_windowed_read_total` exactly once. The centre/half-width
    // round-trip is exact: fromMs/toMs are integers, so their mean and
    // half-difference are exactly representable and reconstruct the bounds.
    if (options?.window) {
      const { fromMs, toMs } = options.window;
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
              ? await this.queryByTraceId(tenantId, traceId, {
                  fromMs: window.fromMs,
                  toMs: window.toMs,
                })
              : null,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(
          { tenantId, traceId, error: errorMessage },
          "Failed to get trace summary from ClickHouse",
        );
        throw error;
      }
    }

    // One logical read with two stages, mapped onto queryWindowed so the
    // outcome lands on `clickhouse_windowed_read_total{table}` exactly once per
    // call:
    //
    //  - Hinted stage (the windowed `run`): when the caller threaded a rough
    //    timestamp, narrow the heavy read to a ±2-day window around it for
    //    partition pruning. The IO/Attributes columns are heavy and without
    //    pruning ClickHouse scans every partition including cold S3 tier — this
    //    trims drawer-open latency from ~1s to ~100ms. A hit here is the fast
    //    happy path (outcome `hit`).
    //  - Fallback stage (the unbounded `run`): the hint is *best-effort*. If the
    //    hint window misses (clock skew, stale URL, the row's `timestamp` ≠
    //    trace's actual OccurredAt), or when there was no hint at all, resolve
    //    the real OccurredAt via a cheap sort-key seek and bound the retry so
    //    the drawer doesn't 404 on a trace that genuinely exists. This is the
    //    slow path (outcome `unbounded_hit`/`unbounded_empty`, or `unwindowed`
    //    when no hint was ever supplied).
    //
    // The resolve+retry lives inside the fallback `run`, so the cheap seek fires
    // only when the hinted stage misses (or is skipped) — never on the happy
    // path, keeping exactly the same SQL attempts in the same order as before.
    const hasHint = options?.occurredAtMs !== undefined;

    try {
      return await queryWindowed<TraceSummaryData | null>({
        table: TABLE_NAME,
        hintMs: options?.occurredAtMs ?? null,
        fallback: "unbounded",
        isEmpty: (result) => result === null,
        run: async (window) => {
          if (window) {
            return await this.queryByTraceId(tenantId, traceId, {
              fromMs: window.fromMs,
              toMs: window.toMs,
            });
          }
          // Fallback stage: the hint window missed, or there was no hint.
          if (hasHint) {
            logger.debug(
              { tenantId, traceId, occurredAtMs: options!.occurredAtMs },
              "Trace summary not found in hint window — resolving OccurredAt to bound the retry",
            );
          }
          // Resolve the trace's OccurredAt from a cheap sort-key seek and bound
          // the heavy read, instead of scanning every weekly partition (incl.
          // cold S3). OccurredAt is the trace's occurrence time and is stable
          // across versions (it's the `PARTITION BY toYearWeek(OccurredAt)`
          // key), so the ±2-day window always contains the row — no unbounded
          // fallback is needed for normal rows. A trace genuinely absent returns
          // null from the light scan without ever issuing the heavy read;
          // historical sentinel rows still use the legacy unbounded fallback to
          // preserve correctness.
          const resolved = await this.resolveOccurredAtMs({
            tenantId,
            traceId,
          });
          if (!resolved.found) return null;
          if (resolved.occurredAtMs === undefined) {
            logger.debug(
              { tenantId, traceId },
              "Trace summary resolved with sentinel OccurredAt — falling back to unbounded read",
            );
            return await this.queryByTraceId(tenantId, traceId);
          }
          return await this.queryByTraceId(tenantId, traceId, {
            fromMs: resolved.occurredAtMs - DEFAULT_PARTITION_WINDOW_MS,
            toMs: resolved.occurredAtMs + DEFAULT_PARTITION_WINDOW_MS,
          });
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, traceId, error: errorMessage },
        "Failed to get trace summary from ClickHouse",
      );
      throw error;
    }
  }

  /**
   * Resolve a trace's OccurredAt (the `PARTITION BY toYearWeek(...)` column)
   * so {@link findByTraceId} can prune partitions even when the caller never
   * threaded an `occurredAtMs` hint (or the hint window missed). The table is
   * `ORDER BY (TenantId, TraceId)`, so this is a sort-key point seek over a
   * couple of granules of small columns — far cheaper than letting the heavy
   * single-trace read fall back to scanning every weekly partition (incl. cold
   * S3). For a not-yet-projected / absent trace this also lets the caller skip
   * the heavy read entirely. Rows that still carry the historical
   * `OccurredAt = 0` sentinel are reported as found without a usable timestamp
   * so the caller can preserve correctness with the legacy unbounded fallback.
   *
   * Since ADR-087 no NEW row can carry that sentinel — `OccurredAt` is the frozen
   * storage anchor and every write validates it — so the unbounded arm below is
   * a legacy-row path that drains as those rows are rewritten or reaped. It is
   * kept because it is a single-trace read, unlike the batch span read that the
   * same sentinel drove into `MEMORY_LIMIT_EXCEEDED`.
   */
  private async resolveOccurredAtMs({
    tenantId,
    traceId,
  }: {
    tenantId: string;
    traceId: string;
  }): Promise<{ found: boolean; occurredAtMs?: number }> {
    const client = await this.resolveClient(tenantId);
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
    const rows = (await result.json()) as Array<{
      rowCount: string | number;
      occurredAtMs: string | number | null;
    }>;
    const rowCountRaw = rows[0]?.rowCount;
    const raw = rows[0]?.occurredAtMs;
    const rowCount =
      typeof rowCountRaw === "string"
        ? Number(rowCountRaw)
        : (rowCountRaw ?? NaN);
    if (!Number.isFinite(rowCount) || rowCount <= 0) {
      return { found: false };
    }
    if (raw === null || raw === undefined) return { found: true };
    // A positive OccurredAt can safely bound the read. Historical rows with the
    // epoch sentinel (0) must fall back to the legacy unbounded lookup because
    // they do exist but have no usable partition key.
    const ms = typeof raw === "string" ? Number(raw) : raw;
    return Number.isFinite(ms) && ms > 0
      ? { found: true, occurredAtMs: ms }
      : { found: true };
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

    const client = await this.resolveClient(tenantId);
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

  private fromClickHouseRecord(
    record: ClickHouseSummaryRecord,
  ): TraceSummaryData {
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
      // The anchor comes back frozen: whatever the column holds is what the row
      // was partitioned and TTL'd on, so re-deriving it would be free to move it.
      storageAnchorMs: record.OccurredAt,
      // …and the timing baseline comes back from its OWN column, never from the
      // anchor. Reading it off `OccurredAt` would hand `SpanTimingService` a
      // log-shaped accept time as a span start and inflate the trace's duration
      // by the whole ingest lag — and for a log-only trace it would fabricate a
      // span that never arrived.
      //
      // The one exception is a PRE-SPLIT row, where the two were the same column
      // and `OccurredAt` is the `min(span start)` this field wants. Taking it
      // there is what lets the population heal without a refold; taking it
      // anywhere else is the inflation bug above. Anything not stamped at the
      // current version predates the split, so the branch is a single equality
      // (see TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR).
      occurredAt:
        record.Version === TRACE_SUMMARY_PROJECTION_VERSION_LATEST
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
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
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
        data.timeToFirstTokenMs != null
          ? Math.round(data.timeToFirstTokenMs)
          : null,
      TimeToLastTokenMs:
        data.timeToLastTokenMs != null
          ? Math.round(data.timeToLastTokenMs)
          : null,
      TotalDurationMs: Math.round(data.totalDurationMs),
      TokensPerSecond:
        data.tokensPerSecond != null ? Math.round(data.tokensPerSecond) : null,
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
