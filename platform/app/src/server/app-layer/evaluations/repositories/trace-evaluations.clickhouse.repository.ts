/**
 * Reads `evaluation_runs` for the per-trace evaluations read path
 * (`EvaluationService`). Moved out of the service so the query, the
 * ReplacingMergeTree dedup, and the memory-limit degrade-to-light-projection
 * retry — all facts about this table's storage shape — live behind a
 * repository instead of in a service that also owns tracing and the
 * stored-object inputs resolution.
 */

import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { defaultClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
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
  tenantId: string;
  traceIds: string[];
}

export interface FindInputsByEvaluationIdInput {
  tenantId: string;
  evaluationId: string;
}

export interface TraceEvaluationsRepository {
  findManyByTraceIds(
    input: FindManyByTraceIdsInput,
  ): Promise<Record<string, TraceEvaluation[]>>;
  /** Raw parsed `Inputs` JSON — the caller resolves ADR-040 offload markers. */
  findInputsByEvaluationId(
    input: FindInputsByEvaluationIdInput,
  ): Promise<Record<string, unknown> | null>;
}

export class TraceEvaluationsClickHouseRepository
  implements TraceEvaluationsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async findManyByTraceIds({
    tenantId,
    traceIds,
  }: FindManyByTraceIdsInput): Promise<Record<string, TraceEvaluation[]>> {
    if (traceIds.length === 0) return {};

    const client = await this.resolveClient(tenantId);

    const runQuery = async (columns: string) => {
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
    };

    const groupByTrace = (
      rows: ClickHouseEvaluationRunRow[],
    ): Record<string, TraceEvaluation[]> => {
      const grouped: Record<string, TraceEvaluation[]> = {};
      for (const traceId of traceIds) {
        grouped[traceId] = [];
      }
      for (const row of rows) {
        const traceId = row.TraceId;
        if (traceId) {
          if (!grouped[traceId]) {
            grouped[traceId] = [];
          }
          grouped[traceId]!.push(mapClickHouseEvaluationToTraceEvaluation(row));
        }
      }
      return grouped;
    };

    try {
      return groupByTrace(await runQuery(EVAL_COLUMNS_WITH_INPUTS));
    } catch (error) {
      if (isMemoryLimitError(error)) {
        logger.warn(
          { tenantId, traceIdCount: traceIds.length },
          "Evaluations read hit the ClickHouse memory limit; retrying without Inputs",
        );
        try {
          return groupByTrace(await runQuery(EVAL_COLUMNS_LIGHT));
        } catch (retryError) {
          logger.error(
            {
              tenantId,
              traceIdCount: traceIds.length,
              error:
                retryError instanceof Error ? retryError.message : retryError,
            },
            "Failed to fetch evaluations for multiple traces from ClickHouse after light-projection retry",
          );
          throw new Error("Failed to fetch evaluations for multiple traces");
        }
      }
      logger.error(
        {
          tenantId,
          traceIdCount: traceIds.length,
          error: error instanceof Error ? error.message : error,
        },
        "Failed to fetch evaluations for multiple traces from ClickHouse",
      );
      throw new Error("Failed to fetch evaluations for multiple traces");
    }
  }

  /**
   * Fetch the heavy `Inputs` blob for one evaluation, on demand.
   *
   * Keyed by `EvaluationId` — the table's second sort column — so ClickHouse
   * prunes to the matching granule(s) and the read stays bounded. Returns
   * null when the evaluation recorded no inputs, the client is unavailable,
   * or the (already-pruned) read still hits the memory ceiling: all three
   * are "nothing to show", not errors worth failing the caller over.
   */
  async findInputsByEvaluationId({
    tenantId,
    evaluationId,
  }: FindInputsByEvaluationIdInput): Promise<Record<string, unknown> | null> {
    let client;
    try {
      client = await this.resolveClient(tenantId);
    } catch (error) {
      logger.warn(
        {
          tenantId,
          evaluationId,
          error: error instanceof Error ? error.message : error,
        },
        "ClickHouse client unavailable for evaluation inputs read",
      );
      return null;
    }

    try {
      const result = await client.query({
        query: `
          SELECT argMax(Inputs, UpdatedAt) AS Inputs
          FROM evaluation_runs
          WHERE TenantId = {tenantId:String}
            AND EvaluationId = {evaluationId:String}
        `,
        query_params: { tenantId, evaluationId },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as { Inputs: string | null }[];
      const parsed = safeJsonParse(rows[0]?.Inputs ?? null);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch (error) {
      if (isMemoryLimitError(error)) {
        logger.warn(
          { tenantId, evaluationId },
          "Evaluation inputs read hit the ClickHouse memory limit even when keyed by EvaluationId",
        );
        return null;
      }
      logger.error(
        {
          tenantId,
          evaluationId,
          error: error instanceof Error ? error.message : error,
        },
        "Failed to fetch evaluation inputs from ClickHouse",
      );
      throw new Error("Failed to fetch evaluation inputs");
    }
  }
}

/** Production default: the standard per-project resolver. */
export function createDefaultTraceEvaluationsRepository(): TraceEvaluationsClickHouseRepository {
  return new TraceEvaluationsClickHouseRepository(
    defaultClickHouseClientResolver,
  );
}
