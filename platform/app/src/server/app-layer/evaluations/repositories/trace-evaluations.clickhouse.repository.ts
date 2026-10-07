/**
 * Reads `evaluation_runs` for the per-trace evaluations read path
 * (`EvaluationService`). Moved out of the service so the query, the
 * ReplacingMergeTree dedup, and the memory-limit degrade-to-light-projection
 * retry — all facts about this table's storage shape — live behind a
 * repository instead of in a service that also owns tracing and the
 * stored-object inputs resolution.
 *
 * The drawer's reads take the proof (ADR-144 block F), so on an aggregate
 * they read the member that holds the trace. The by-tenant read stays for
 * the callers that still hand a project id: the REST surfaces, the share
 * link and the evaluation worker.
 */

import type { Authorization } from "@langwatch/actor";
import { createLogger } from "@langwatch/observability";
import {
  type AuthorizedClickHouse,
  TenantReaderClientUnavailableError,
  tenantScope,
  tenantScopeKey,
} from "~/server/app-layer/clients/clickhouse/authorized-reads";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { safeJsonParse } from "~/utils/safeJsonParse";
import type { ClickHouseEvaluationRunRow } from "../../../evaluations/evaluation-run.mappers";
import { mapClickHouseEvaluationToTraceEvaluation } from "../../../evaluations/evaluation-run.mappers";
import type { TraceEvaluation } from "../../../evaluations/evaluation-run.types";

const logger = createLogger(
  "langwatch:app-layer:evaluations:trace-evaluations-repository",
);

/**
 * Columns the evaluation mapper actually reads, minus the heavy `Inputs`
 * blob. `evaluation_runs` is `ORDER BY (TenantId, EvaluationId)`, so a
 * `TraceId` filter can't prune granules — ClickHouse reads whole granules
 * to evaluate the predicate, and when `Inputs` holds multi-MB payloads
 * (RAG contexts, full conversations) materialising one granule blows past
 * the per-query memory ceiling. The light projection lets us still return
 * verdicts/scores when the heavy read would OOM.
 */
const EVAL_COLUMNS_LIGHT = [
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

const EVAL_COLUMNS_WITH_INPUTS = `${EVAL_COLUMNS_LIGHT}, Inputs`;

/**
 * ClickHouse raises this when a query would exceed `max_memory_usage`.
 * We match on the stable prefix rather than the (variable) GiB figures.
 */
function isMemoryLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /memory limit\s*(exceeded|.*exceeded)/i.test(message);
}

export interface FindManyByTraceIdsInput {
  authorization: Authorization;
  traceIds: string[];
}

export interface FindManyByTraceIdsForTenantInput {
  tenantId: string;
  traceIds: string[];
}

export interface FindInputsByEvaluationIdInput {
  authorization: Authorization;
  evaluationId: string;
}

/**
 * One evaluation's raw parsed `Inputs` JSON, with the project the row was
 * read from: an offloaded marker lives under that project, which on an
 * aggregate is a member rather than the aggregate.
 */
export interface EvaluationInputsRead {
  tenantId: string;
  inputs: Record<string, unknown> | null;
}

type ReadEvaluationRows = (
  columns: string,
) => Promise<ClickHouseEvaluationRunRow[]>;

export interface TraceEvaluationsRepository {
  /** The evaluations the proof reads, grouped by trace. */
  findManyByTraceIds(
    input: FindManyByTraceIdsInput,
  ): Promise<Record<string, TraceEvaluation[]>>;
  /** The same read for a caller that still hands a project id. */
  findManyByTraceIdsForTenant(
    input: FindManyByTraceIdsForTenantInput,
  ): Promise<Record<string, TraceEvaluation[]>>;
  /** Raw parsed `Inputs` JSON — the caller resolves ADR-040 offload markers. */
  findInputsByEvaluationId(
    input: FindInputsByEvaluationIdInput,
  ): Promise<EvaluationInputsRead | null>;
}

export class TraceEvaluationsClickHouseRepository
  implements TraceEvaluationsRepository
{
  private readonly resolveClient: ClickHouseClientResolver;
  private readonly clickhouse: AuthorizedClickHouse;

  constructor({
    resolveClient,
    clickhouse,
  }: {
    resolveClient: ClickHouseClientResolver;
    clickhouse: AuthorizedClickHouse;
  }) {
    this.resolveClient = resolveClient;
    this.clickhouse = clickhouse;
  }

  /**
   * The fence is the only tenant predicate, in the outer scope and in the
   * dedup subquery alike, on `ScheduledAt`, the table's partition column.
   * Nothing here projects a column under the name of a raw one, so the bare
   * `ScheduledAt` the fence writes is the stored column in both scopes.
   */
  async findManyByTraceIds({
    authorization,
    traceIds,
  }: FindManyByTraceIdsInput): Promise<Record<string, TraceEvaluation[]>> {
    if (traceIds.length === 0) return {};
    const reader = this.clickhouse.as(authorization, { reads: "traces" });
    return this.#readGrouped({
      traceIds,
      read: async (columns) => {
        const result = await reader.query({
          query: `
            SELECT ${columns}
            FROM evaluation_runs
            WHERE ${tenantScope("ScheduledAt")}
              AND TraceId IN ({traceIds:Array(String)})
              AND (TenantId, EvaluationId, UpdatedAt) IN (
                SELECT TenantId, EvaluationId, max(UpdatedAt)
                FROM evaluation_runs
                WHERE ${tenantScope("ScheduledAt")}
                  AND TraceId IN ({traceIds:Array(String)})
                GROUP BY TenantId, EvaluationId
              )
          `,
          query_params: { traceIds },
          format: "JSONEachRow",
        });
        return (await result.json()) as ClickHouseEvaluationRunRow[];
      },
    });
  }

  async findManyByTraceIdsForTenant({
    tenantId,
    traceIds,
  }: FindManyByTraceIdsForTenantInput): Promise<
    Record<string, TraceEvaluation[]>
  > {
    if (traceIds.length === 0) return {};

    // Resolution failure is a read failure like any other. Left outside the
    // try it escaped as the resolver's own `ClickHouse not available for
    // tenant ...`, so the one call that could not reach ClickHouse at all
    // failed differently from every call that reached it and failed.
    let client: Awaited<ReturnType<ClickHouseClientResolver>>;
    try {
      client = await this.resolveClient(tenantId);
    } catch (error) {
      this.#reportReadFailure({ tenantId, traceIds, error });
      throw new Error("Failed to fetch evaluations for multiple traces");
    }

    return this.#readGrouped({
      traceIds,
      tenantId,
      read: async (columns) => {
        const result = await client.query({
          query: `
            SELECT ${columns}
            FROM evaluation_runs
            WHERE TenantId = {tenantId:String}
              AND TraceId IN ({traceIds:Array(String)})
              AND (TenantId, EvaluationId, UpdatedAt) IN (
                SELECT TenantId, EvaluationId, max(UpdatedAt)
                FROM evaluation_runs
                WHERE TenantId = {tenantId:String}
                  AND TraceId IN ({traceIds:Array(String)})
                GROUP BY TenantId, EvaluationId
              )
          `,
          query_params: { tenantId, traceIds },
          format: "JSONEachRow",
        });
        return (await result.json()) as ClickHouseEvaluationRunRow[];
      },
    });
  }

  /**
   * Fetch the heavy `Inputs` blob for one evaluation, on demand, from the
   * project the proof reads it in.
   *
   * Keyed by `EvaluationId` — the table's second sort column — so ClickHouse
   * prunes to the matching granule(s) and the read stays bounded. Grouped by
   * tenant and ordered by it, so on an aggregate the read names one project,
   * the same one every time. Returns null when no project the proof reads
   * holds the evaluation, the project's ClickHouse client cannot be resolved,
   * or the (already-pruned) read still hits the memory ceiling: all three are
   * "nothing to show", not errors worth failing the caller over. Any other
   * query failure still throws.
   */
  async findInputsByEvaluationId({
    authorization,
    evaluationId,
  }: FindInputsByEvaluationIdInput): Promise<EvaluationInputsRead | null> {
    try {
      const reader = this.clickhouse.as(authorization, { reads: "traces" });
      const result = await reader.query({
        query: `
          SELECT TenantId, argMax(Inputs, UpdatedAt) AS Inputs
          FROM evaluation_runs
          WHERE ${tenantScope("ScheduledAt")}
            AND EvaluationId = {evaluationId:String}
          GROUP BY TenantId
          ORDER BY TenantId
          LIMIT 1
        `,
        query_params: { evaluationId },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as {
        TenantId: string;
        Inputs: string | null;
      }[];
      const row = rows[0];
      if (!row) return null;
      return {
        tenantId: row.TenantId,
        inputs: asPlainObject(safeJsonParse(row.Inputs ?? null)),
      };
    } catch (error) {
      if (error instanceof TenantReaderClientUnavailableError) {
        logger.warn(
          {
            evaluationId,
            scope: tenantScopeKey({ authorization, reads: "traces" }),
            error: error.message,
          },
          "ClickHouse client unavailable for evaluation inputs read",
        );
        return null;
      }
      if (isMemoryLimitError(error)) {
        logger.warn(
          { evaluationId },
          "Evaluation inputs read hit the ClickHouse memory limit even when keyed by EvaluationId",
        );
        return null;
      }
      logger.warn(
        {
          evaluationId,
          error: error instanceof Error ? error.message : error,
        },
        "Failed to fetch evaluation inputs from ClickHouse",
      );
      throw new Error("Failed to fetch evaluation inputs");
    }
  }

  /**
   * One evaluations read, grouped by trace, with the memory-limit retry.
   *
   * Only the memory ceiling earns a second attempt, with only the light
   * columns: `Inputs` is the heavy one, and dropping it is what brings a read
   * that hit the ceiling back inside it. Anything else - a syntax error, a
   * dead connection - fails now: retrying it would just spend the same budget
   * to fail identically.
   */
  async #readGrouped({
    traceIds,
    tenantId,
    read,
  }: {
    traceIds: string[];
    tenantId?: string;
    read: ReadEvaluationRows;
  }): Promise<Record<string, TraceEvaluation[]>> {
    try {
      return this.#groupByTrace(await read(EVAL_COLUMNS_WITH_INPUTS), traceIds);
    } catch (error) {
      if (!isMemoryLimitError(error)) {
        this.#reportReadFailure({ tenantId, traceIds, error });
        throw new Error("Failed to fetch evaluations for multiple traces");
      }
    }
    logger.warn(
      { tenantId, traceIdCount: traceIds.length },
      "Evaluations read hit the ClickHouse memory limit; retrying without Inputs",
    );
    try {
      return this.#groupByTrace(await read(EVAL_COLUMNS_LIGHT), traceIds);
    } catch (error) {
      this.#reportReadFailure({ tenantId, traceIds, error, isRetry: true });
      throw new Error("Failed to fetch evaluations for multiple traces");
    }
  }

  /** Every requested trace gets a key, so a caller can index without a guard. */
  #groupByTrace(
    rows: ClickHouseEvaluationRunRow[],
    traceIds: string[],
  ): Record<string, TraceEvaluation[]> {
    const grouped: Record<string, TraceEvaluation[]> = {};
    for (const traceId of traceIds) {
      grouped[traceId] = [];
    }
    for (const row of rows) {
      const traceId = row.TraceId;
      if (!traceId) continue;
      (grouped[traceId] ??= []).push(
        mapClickHouseEvaluationToTraceEvaluation(row),
      );
    }
    return grouped;
  }

  #reportReadFailure({
    tenantId,
    traceIds,
    error,
    isRetry = false,
  }: {
    tenantId?: string;
    traceIds: string[];
    error: unknown;
    isRetry?: boolean;
  }): void {
    logger.error(
      {
        tenantId,
        traceIdCount: traceIds.length,
        error: error instanceof Error ? error.message : error,
      },
      isRetry
        ? "Failed to fetch evaluations for multiple traces from ClickHouse after light-projection retry"
        : "Failed to fetch evaluations for multiple traces from ClickHouse",
    );
  }
}

/** A JSON object, or null for anything else - an array, a scalar, a parse failure. */
function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
