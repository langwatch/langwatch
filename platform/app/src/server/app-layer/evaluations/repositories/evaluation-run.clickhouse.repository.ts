import type { Authorization } from "@langwatch/actor";
import { createLogger } from "@langwatch/observability";
import {
  type AuthorizedClickHouse,
  ownProjectIdOf,
  singleTenantOf,
  tenantScope,
  tenantScopeKey,
  tenantSet,
} from "~/server/app-layer/clients/clickhouse/authorized-reads";
import { createRetentionFloorService } from "~/server/app-layer/clients/clickhouse/retention-floor";
import { RESOLVER_RECENT_WINDOW_MS } from "~/server/app-layer/clients/clickhouse/windowed-read";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { WithDateWrites } from "~/server/clickhouse/types";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { RetentionPolicyResolver } from "~/server/data-retention/retentionPolicyResolver";
import { EVALUATION_PROJECTION_VERSIONS } from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/constants";
import { IdUtils } from "~/server/event-sourcing/pipelines/evaluation-processing/utils/id.utils";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { validateBatchTenants } from "../../_shared/clickhouse-batch";
import { capSerializedInputs, capText } from "../evaluation-column-caps";
import type { EvaluationRunData } from "../types";
import type {
  EvaluationRunRepository,
  FindByTraceIdParams,
  GetByEvaluationIdParams,
  TenantEvalSummary,
} from "./evaluation-run.repository";

const TABLE_NAME = "evaluation_runs" as const;

const logger = createLogger(
  "langwatch:app-layer:evaluations:evaluation-run-repository",
);

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
  CreatedAt: number;
  UpdatedAt: number;
  ArchivedAt: number | null;
  ScheduledAt: number | null;
  StartedAt: number | null;
  CompletedAt: number | null;
  CostId: string | null;
  LastProcessedEventId: string;
  LastEventOccurredAt: number;
  _retention_days: number;
}

type ClickHouseEvaluationRunWriteRecord = WithDateWrites<
  ClickHouseEvaluationRunRecord,
  | "CreatedAt"
  | "UpdatedAt"
  | "ArchivedAt"
  | "ScheduledAt"
  | "StartedAt"
  | "CompletedAt"
  | "LastEventOccurredAt"
>;

export class EvaluationRunClickHouseRepository
  implements EvaluationRunRepository
{
  private readonly resolveClient: ClickHouseClientResolver;
  /**
   * The proof-fenced reader every read goes through (ADR-144 blocks C and
   * F). Only the writes resolve a tenant's own client, since a write carries
   * no proof; the lint gate in
   * `clients/clickhouse/__tests__/store-call-carries-authorization.unit.test.ts`
   * keeps it so.
   */
  private readonly clickhouse: AuthorizedClickHouse;

  constructor({
    resolveClient,
    clickhouse,
    retentionResolver,
  }: {
    resolveClient: ClickHouseClientResolver;
    clickhouse: AuthorizedClickHouse;
    /**
     * Bounds the ScheduledAt resolver's fallback to this tenant's own retention
     * horizon. Optional so existing construction sites keep working on the
     * platform default; see {@link resolveScheduledAtMs}.
     */
    retentionResolver?: RetentionPolicyResolver;
  }) {
    this.resolveClient = resolveClient;
    this.clickhouse = clickhouse;
    this.retentionFloor = createRetentionFloorService(retentionResolver);
  }

  private readonly retentionFloor: ReturnType<
    typeof createRetentionFloorService
  >;

  async upsert(
    data: EvaluationRunData,
    tenantId: string,
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId },
      "EvaluationRunClickHouseRepository.upsert",
    );

    const projectionId = data.scheduledAt
      ? IdUtils.generateDeterministicEvaluationRunId(
          tenantId,
          data.evaluationId,
          data.scheduledAt,
        )
      : data.evaluationId;

    try {
      const client = await this.resolveClient(tenantId);
      const record = this.toClickHouseRecord(
        data,
        tenantId,
        projectionId,
        EVALUATION_PROJECTION_VERSIONS.STATE,
        retentionDays,
      );

      await client.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
        { tenantId, evaluationId: data.evaluationId, error },
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
      "EvaluationRunClickHouseRepository.upsertBatch",
    );

    try {
      const client = await this.resolveClient(tenantId);
      const records = entries.map(
        ({ data, tenantId: tid, retentionDays: rd }) => {
          const projectionId = data.scheduledAt
            ? IdUtils.generateDeterministicEvaluationRunId(
                tid,
                data.evaluationId,
                data.scheduledAt,
              )
            : data.evaluationId;
          return this.toClickHouseRecord(
            data,
            tid,
            projectionId,
            EVALUATION_PROJECTION_VERSIONS.STATE,
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
      logger.warn(
        { tenantId, count: entries.length, error },
        "Failed to batch store evaluation runs in ClickHouse",
      );
      throw error;
    }
  }

  /**
   * Resolve an evaluation's ScheduledAt (the `PARTITION BY toYearWeek(...)`
   * column) so {@link getByEvaluationId} can prune partitions even when the
   * caller never threaded a `scheduledAt` hint. `evaluation_runs` is
   * `ORDER BY (TenantId, EvaluationId)`, so this is a sort-key point seek over
   * a couple of granules of small columns — far cheaper than letting the heavy
   * read fall back to scanning every weekly partition (incl. cold S3).
   *
   * `argMax(ScheduledAt, UpdatedAt)` takes the ScheduledAt of the latest
   * version (the same row the dedup keeps). Returns undefined when the
   * evaluation isn't in the table, where the caller stays unbounded.
   *
   * Two-phase probe: without a ScheduledAt predicate this seek itself walks
   * every weekly partition's index — including S3-tiered cold ones — costing
   * whole seconds per call, while the job paths call it for evaluations
   * scheduled minutes ago. Probing the recent window first keeps the hot
   * path on local-disk partitions; only a miss (old or unknown evaluation)
   * pays the unbounded fallback.
   */
  private async resolveScheduledAtMs({
    authorization,
    evaluationId,
  }: {
    authorization: Authorization;
    evaluationId: string;
  }): Promise<{ scheduledAtMs?: number; floorMs: number }> {
    // Floor the fallback at this tenant's retention horizon rather than leaving
    // it unbounded. `evaluation_runs` is partitioned on ScheduledAt, so a query
    // with no lower bound prunes nothing and walks every partition including
    // cold S3 — which is why this was the single largest source of cold-scan
    // queries in production. Nothing older than retention survives TTL, so the
    // floor cannot hide a row the unbounded scan would have found.
    //
    // The floor is returned alongside the answer because a MISS needs it too:
    // it is the bound `getByEvaluationId` falls back to, so the heavy read is
    // bounded on the one path that used to leave it unbounded.
    const floorMs = await this.retentionFloor.getFloorMs({
      table: TABLE_NAME,
      tenantId: retentionTenantOf(authorization),
    });

    const recent = await this.queryScheduledAtMs({
      authorization,
      evaluationId,
      sinceMs: Date.now() - RESOLVER_RECENT_WINDOW_MS,
    });
    if (recent !== undefined) return { scheduledAtMs: recent, floorMs };

    return {
      scheduledAtMs: await this.queryScheduledAtMs({
        authorization,
        evaluationId,
        sinceMs: floorMs,
      }),
      floorMs,
    };
  }

  /**
   * The `ScheduledAt` bounds {@link getByEvaluationId}'s heavy read runs under.
   *
   * Total by construction: every path returns a lower bound, because the path
   * that did not is the read this exists to remove. A resolver miss used to
   * drop both predicates and scan every weekly partition, cold S3 included,
   * for an evaluation that by definition is not there.
   *
   * A miss is safe to floor precisely BECAUSE it is a miss: the resolver has
   * already searched `ScheduledAt >= floor` with no upper bound and found
   * nothing, so no row above the floor exists for the heavy read to find
   * either. Anything below the floor is past retention and TTL-eligible.
   * `ScheduledAt` is `DateTime64(3) DEFAULT now64(3)` — never null — so there
   * is no unscheduled row hiding beneath the bound.
   *
   * The miss branch takes no upper bound: `>= floor` prunes every older
   * partition, which is the whole win, and capping at `now` would exclude
   * evaluations legitimately scheduled into the future.
   */
  private async resolveScheduledAtRange({
    authorization,
    evaluationId,
    hintedScheduledAtMs,
    slackMs,
  }: {
    authorization: Authorization;
    evaluationId: string;
    hintedScheduledAtMs?: number;
    slackMs: number;
  }): Promise<{ scheduledAtFrom: number; scheduledAtTo?: number }> {
    const centreOn = (scheduledAtMs: number) => ({
      scheduledAtFrom: scheduledAtMs - slackMs,
      scheduledAtTo: scheduledAtMs + slackMs,
    });

    if (hintedScheduledAtMs !== undefined) return centreOn(hintedScheduledAtMs);

    // No hint (event-sourcing projection reads, internal callers): resolve it
    // from a cheap sort-key point seek so the heavy read still prunes
    // partitions instead of scanning every weekly one incl. cold S3.
    const { scheduledAtMs, floorMs } = await this.resolveScheduledAtMs({
      authorization,
      evaluationId,
    });

    return scheduledAtMs !== undefined
      ? centreOn(scheduledAtMs)
      : { scheduledAtFrom: floorMs };
  }

  private async queryScheduledAtMs({
    authorization,
    evaluationId,
    sinceMs,
  }: {
    authorization: Authorization;
    evaluationId: string;
    sinceMs?: number;
  }): Promise<number | undefined> {
    const client = this.clickhouse.as(authorization, { reads: "traces" });
    const windowPredicate =
      sinceMs !== undefined
        ? "AND ScheduledAt >= fromUnixTimestamp64Milli({sinceMs:Int64})"
        : "";
    const result = await client.query({
      query: `
        SELECT toUnixTimestamp64Milli(argMax(ScheduledAt, UpdatedAt)) AS scheduledAtMs
        FROM ${TABLE_NAME}
        WHERE ${tenantScope("ScheduledAt")}
          AND EvaluationId = {evaluationId:String}
          ${windowPredicate}
      `,
      query_params:
        sinceMs !== undefined ? { evaluationId, sinceMs } : { evaluationId },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      scheduledAtMs: string | number | null;
    }>;
    const raw = rows[0]?.scheduledAtMs;
    if (raw === null || raw === undefined) return undefined;
    // argMax over no matching rows yields the epoch default (0); treat that —
    // and any non-positive value — as "unknown" so the caller stays unbounded.
    const ms = typeof raw === "string" ? Number(raw) : raw;
    return Number.isFinite(ms) && ms > 0 ? ms : undefined;
  }

  async getByEvaluationId({
    authorization,
    evaluationId,
    hints,
  }: GetByEvaluationIdParams): Promise<EvaluationRunData | null> {
    try {
      const client = this.clickhouse.as(authorization, { reads: "traces" });

      // IN-tuple dedup over the ReplacingMergeTree, with two ClickHouse-
      // specific shapes that matter under load:
      //
      // 1. PREWHERE on the IN-tuple — runs the predicate before SELECT-column
      //    reads, so the heavy ZSTD(3) columns (Inputs, Details, Error,
      //    ErrorDetails) only get decompressed for the one row that wins
      //    max(UpdatedAt). With plain WHERE the engine reads heavy columns
      //    for every unmerged version of the matched key range first, then
      //    filters — which on `evaluation_runs` was observed at ~5.8 MB
      //    decompressed per call even for a single-row lookup.
      //
      // 2. Partition predicate on ScheduledAt when the caller knows it. The
      //    table is `PARTITION BY toYearWeek(ScheduledAt)`; without a bound
      //    the engine scans every weekly partition (incl. cold storage on
      //    S3). The default ±7 day window covers the typical eval lifetime
      //    (schedule → run → archive) without missing late status updates.
      //
      // Outer SELECT/WHERE references columns via the `t.` alias because the
      // SELECT projects `toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt`
      // (and similar for Created/Archived/Scheduled/Started/CompletedAt).
      // Without the alias the IN-tuple's `UpdatedAt` could resolve to the
      // projected UInt64 alias instead of the raw DateTime64 column and the
      // type comparison would break. See
      // dev/docs/best_practices/clickhouse-queries.md.
      //
      // The same alias decides where the fence goes. Its windowed form names
      // a bare `ScheduledAt`, which in the outer scope is that UInt64 alias,
      // so the window is applied once, in the dedup subquery that reads the
      // raw column; the outer scope takes the tenant set alone, which the
      // IN-tuple already narrows to the winning (tenant, evaluation) row.

      const { scheduledAtFrom, scheduledAtTo } =
        await this.resolveScheduledAtRange({
          authorization,
          evaluationId,
          hintedScheduledAtMs: hints?.scheduledAt?.getTime(),
          slackMs: hints?.scheduledAtSlackMs ?? 7 * 24 * 60 * 60 * 1000,
        });

      const boundsSql = (column: string) =>
        `AND ${column} >= fromUnixTimestamp64Milli({scheduledAtFrom:Int64})` +
        (scheduledAtTo !== undefined
          ? ` AND ${column} <= fromUnixTimestamp64Milli({scheduledAtTo:Int64})`
          : "");
      const partitionPredicate = boundsSql("t.ScheduledAt");
      const innerPartitionPredicate = boundsSql("ScheduledAt");

      const result = await client.query({
        query: `
          SELECT
            t.ProjectionId AS ProjectionId,
            t.TenantId AS TenantId,
            t.EvaluationId AS EvaluationId,
            t.Version AS Version,
            t.EvaluatorId AS EvaluatorId,
            t.EvaluatorType AS EvaluatorType,
            t.EvaluatorName AS EvaluatorName,
            t.TraceId AS TraceId,
            t.IsGuardrail AS IsGuardrail,
            t.Status AS Status,
            t.Score AS Score,
            t.Passed AS Passed,
            t.Label AS Label,
            t.Details AS Details,
            t.Inputs AS Inputs,
            t.Error AS Error,
            t.ErrorDetails AS ErrorDetails,
            toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(t.ArchivedAt) AS ArchivedAt,
            toUnixTimestamp64Milli(t.ScheduledAt) AS ScheduledAt,
            toUnixTimestamp64Milli(t.StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(t.CompletedAt) AS CompletedAt,
            t.CostId AS CostId,
            t.LastProcessedEventId AS LastProcessedEventId,
            toUnixTimestamp64Milli(t.LastEventOccurredAt) AS LastEventOccurredAt
          FROM ${TABLE_NAME} AS t
          PREWHERE (t.TenantId, t.EvaluationId, t.UpdatedAt) IN (
            SELECT TenantId, EvaluationId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE ${tenantScope("ScheduledAt")}
              AND EvaluationId = {evaluationId:String}
              ${innerPartitionPredicate}
            GROUP BY TenantId, EvaluationId
          )
          WHERE ${tenantSet()}
            AND t.EvaluationId = {evaluationId:String}
            ${partitionPredicate}
          LIMIT 1
        `,
        query_params: {
          evaluationId,
          scheduledAtFrom,
          ...(scheduledAtTo !== undefined ? { scheduledAtTo } : {}),
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseEvaluationRunRecord>();
      const row = rows[0];
      if (!row) return null;

      return this.fromClickHouseRecord(row);
    } catch (error) {
      logger.warn(
        {
          evaluationId,
          scope: tenantScopeKey({ authorization, reads: "traces" }),
          error,
        },
        "Failed to get evaluation run from ClickHouse",
      );
      throw error;
    }
  }

  async findByTraceId({
    authorization,
    traceId,
  }: FindByTraceIdParams): Promise<EvaluationRunData[]> {
    // The outer query reads every column through the `t.` alias: the SELECT
    // projects `toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt`, and a bare
    // `UpdatedAt` in WHERE resolves to that integer alias, which never equals
    // the subquery's DateTime64 `max(UpdatedAt)`, so the read returns no rows.
    // See dev/docs/best_practices/clickhouse-queries.md. The windowed fence
    // names a bare `ScheduledAt` for the same reason, so it sits in the
    // dedup subquery and the outer scope takes the tenant set alone.
    try {
      const client = this.clickhouse.as(authorization, { reads: "traces" });
      const result = await client.query({
        query: `
          SELECT
            t.ProjectionId AS ProjectionId,
            t.TenantId AS TenantId,
            t.EvaluationId AS EvaluationId,
            t.Version AS Version,
            t.EvaluatorId AS EvaluatorId,
            t.EvaluatorType AS EvaluatorType,
            t.EvaluatorName AS EvaluatorName,
            t.TraceId AS TraceId,
            t.IsGuardrail AS IsGuardrail,
            t.Status AS Status,
            t.Score AS Score,
            t.Passed AS Passed,
            t.Label AS Label,
            t.Details AS Details,
            t.Inputs AS Inputs,
            t.Error AS Error,
            t.ErrorDetails AS ErrorDetails,
            toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(t.ArchivedAt) AS ArchivedAt,
            toUnixTimestamp64Milli(t.ScheduledAt) AS ScheduledAt,
            toUnixTimestamp64Milli(t.StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(t.CompletedAt) AS CompletedAt,
            t.CostId AS CostId,
            t.LastProcessedEventId AS LastProcessedEventId,
            toUnixTimestamp64Milli(t.LastEventOccurredAt) AS LastEventOccurredAt
          FROM ${TABLE_NAME} AS t
          WHERE ${tenantSet()}
            AND t.ScheduledAt >= now() - INTERVAL 7 DAY
            AND t.TraceId = {traceId:String}
            AND (t.TenantId, t.EvaluationId, t.UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM ${TABLE_NAME}
              WHERE ${tenantScope("ScheduledAt")}
                AND ScheduledAt >= now() - INTERVAL 7 DAY
                AND TraceId = {traceId:String}
              GROUP BY TenantId, EvaluationId
            )
          ORDER BY t.UpdatedAt DESC
        `,
        query_params: { traceId },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseEvaluationRunRecord>();
      // Dedup is enforced by the IN-tuple subquery on (EvaluationId, max(UpdatedAt))
      // — heavy columns (Inputs/Details/ErrorDetails) are only materialized for
      // the surviving rows, not for every duplicate.
      return rows.map((row) => this.fromClickHouseRecord(row));
    } catch (error) {
      logger.warn(
        {
          traceId,
          scope: tenantScopeKey({ authorization, reads: "traces" }),
          error,
        },
        "Failed to find evaluation runs by trace ID in ClickHouse",
      );
      throw error;
    }
  }

  /**
   * The fence is the only tenant predicate, in the outer scope and in the
   * dedup subquery alike, on `ScheduledAt`, the table's partition column
   * (migration 00002). The window on a shared grant applies to the
   * evaluation's own time, which is what the list's `since` bounds too.
   */
  async findSummariesByTraceIds({
    authorization,
    traceIds,
    since,
  }: {
    authorization: Authorization;
    traceIds: string[];
    since: number;
  }): Promise<TenantEvalSummary[]> {
    if (traceIds.length === 0) return [];

    try {
      const client = this.clickhouse.as(authorization, { reads: "traces" });
      const result = await client.query({
        query: `
          SELECT
            TenantId,
            EvaluationId,
            EvaluatorId,
            EvaluatorType,
            EvaluatorName,
            TraceId,
            IsGuardrail,
            Status,
            Score,
            Passed,
            Label
          FROM ${TABLE_NAME}
          WHERE ${tenantScope("ScheduledAt")}
            AND ScheduledAt >= fromUnixTimestamp64Milli({since:Int64})
            AND TraceId IN ({traceIds:Array(String)})
            AND (TenantId, EvaluationId, UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM ${TABLE_NAME}
              WHERE ${tenantScope("ScheduledAt")}
                AND ScheduledAt >= fromUnixTimestamp64Milli({since:Int64})
                AND TraceId IN ({traceIds:Array(String)})
              GROUP BY TenantId, EvaluationId
            )
          ORDER BY UpdatedAt DESC
        `,
        query_params: { traceIds, since },
        format: "JSONEachRow",
      });

      interface SlimRow {
        TenantId: string;
        EvaluationId: string;
        EvaluatorId: string;
        EvaluatorType: string;
        EvaluatorName: string | null;
        TraceId: string | null;
        IsGuardrail: number;
        Status: string;
        Score: number | null;
        Passed: number | null;
        Label: string | null;
      }

      const rows = await result.json<SlimRow>();

      // Dedup is enforced by the IN-tuple subquery; no JS-side `seen` set.
      return rows.flatMap((row): TenantEvalSummary[] => {
        const traceId = row.TraceId;
        if (!traceId) return [];
        return [
          {
            tenantId: row.TenantId,
            evaluationId: row.EvaluationId,
            evaluatorId: row.EvaluatorId,
            evaluatorType: row.EvaluatorType,
            evaluatorName: row.EvaluatorName,
            traceId,
            isGuardrail: !!row.IsGuardrail,
            status: row.Status as TenantEvalSummary["status"],
            score: row.Score,
            passed: row.Passed === null ? null : !!row.Passed,
            label: row.Label,
          },
        ];
      });
    } catch (error) {
      logger.warn(
        {
          traceIdCount: traceIds.length,
          scope: tenantScopeKey({ authorization, reads: "traces" }),
          error,
        },
        "Failed to find evaluation summaries by trace IDs in ClickHouse",
      );
      throw error;
    }
  }

  private fromClickHouseRecord(
    record: ClickHouseEvaluationRunRecord,
  ): EvaluationRunData {
    return {
      evaluationId: record.EvaluationId,
      evaluatorId: record.EvaluatorId,
      evaluatorType: record.EvaluatorType,
      evaluatorName: record.EvaluatorName,
      traceId: record.TraceId,
      isGuardrail: !!record.IsGuardrail,
      status: record.Status as EvaluationRunData["status"],
      score: record.Score,
      passed: record.Passed === null ? null : !!record.Passed,
      label: record.Label,
      details: record.Details,
      inputs: record.Inputs
        ? (JSON.parse(record.Inputs) as Record<string, unknown>)
        : null,
      error: record.Error,
      errorDetails: record.ErrorDetails,
      createdAt: Number(record.CreatedAt),
      updatedAt: Number(record.UpdatedAt),
      LastEventOccurredAt: Number(record.LastEventOccurredAt ?? 0),
      archivedAt: record.ArchivedAt === null ? null : Number(record.ArchivedAt),
      scheduledAt:
        record.ScheduledAt === null ? null : Number(record.ScheduledAt),
      startedAt: record.StartedAt === null ? null : Number(record.StartedAt),
      completedAt:
        record.CompletedAt === null ? null : Number(record.CompletedAt),
      costId: record.CostId ?? null,
    };
  }

  private toClickHouseRecord(
    data: EvaluationRunData,
    tenantId: string,
    projectionId: string,
    version: string,
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): ClickHouseEvaluationRunWriteRecord {
    // Belt-and-braces write caps (ADR-040): unconditional, flag-independent,
    // last line of defence that keeps the part merge-safe even if the offload
    // path is off, failed open, or a different writer inserted a fat payload.
    // With offload on, `Inputs` is already a small marker object so these are
    // no-ops.
    const cappedInputs = capSerializedInputs(
      data.inputs ? JSON.stringify(data.inputs) : null,
    );
    const cappedDetails = capText(data.details);
    const cappedError = capText(data.error);
    const cappedErrorDetails = capText(data.errorDetails);
    if (
      cappedInputs.truncated ||
      cappedDetails.truncated ||
      cappedError.truncated ||
      cappedErrorDetails.truncated
    ) {
      logger.warn(
        {
          tenantId,
          evaluationId: data.evaluationId,
          inputsOriginalBytes: cappedInputs.originalBytes,
          detailsOriginalBytes: cappedDetails.originalBytes,
          errorOriginalBytes: cappedError.originalBytes,
          errorDetailsOriginalBytes: cappedErrorDetails.originalBytes,
          inputsTruncated: cappedInputs.truncated,
          detailsTruncated: cappedDetails.truncated,
          errorTruncated: cappedError.truncated,
          errorDetailsTruncated: cappedErrorDetails.truncated,
        },
        "evaluation_runs row exceeded a column cap and was truncated at write to stay merge-safe",
      );
    }

    return {
      ProjectionId: projectionId,
      TenantId: tenantId,
      EvaluationId: data.evaluationId,
      Version: version,
      EvaluatorId: data.evaluatorId,
      EvaluatorType: data.evaluatorType,
      EvaluatorName: data.evaluatorName,
      TraceId: data.traceId,
      IsGuardrail: data.isGuardrail ? 1 : 0,
      Status: data.status,
      Score: data.score,
      Passed: data.passed === null ? null : data.passed ? 1 : 0,
      Label: data.label,
      Details: cappedDetails.value,
      Inputs: cappedInputs.value,
      Error: cappedError.value,
      ErrorDetails: cappedErrorDetails.value,
      CreatedAt: new Date(data.createdAt),
      UpdatedAt: new Date(data.updatedAt),
      LastEventOccurredAt: data.LastEventOccurredAt
        ? new Date(data.LastEventOccurredAt)
        : new Date(0),
      ArchivedAt: data.archivedAt != null ? new Date(data.archivedAt) : null,
      ScheduledAt: new Date(data.scheduledAt ?? data.createdAt),
      StartedAt: data.startedAt != null ? new Date(data.startedAt) : null,
      CompletedAt: data.completedAt != null ? new Date(data.completedAt) : null,
      CostId: data.costId ?? null,
      LastProcessedEventId: projectionId,
      _retention_days: retentionDays,
    };
  }
}

/**
 * The tenant whose retention horizon floors an unhinted evaluation read: the
 * one project the proof reads, else the project it was minted for. The
 * worker and the fold store mint an own-only proof, so both name the same
 * project.
 */
function retentionTenantOf(authorization: Authorization): string {
  return (
    singleTenantOf({ authorization, reads: "traces" }) ??
    ownProjectIdOf({ authorization, reads: "traces" })
  );
}
