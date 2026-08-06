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

    try {
      const rows = await this.#read({
        client,
        tenantId,
        traceIds,
        columns: EVAL_COLUMNS_WITH_INPUTS,
      });
      return this.#groupByTrace(rows, traceIds);
    } catch (error) {
      // Only the memory ceiling earns a second attempt. Anything else - a
      // syntax error, a dead connection - fails now, exactly as before:
      // retrying it would just spend the same budget to fail identically.
      if (!isMemoryLimitError(error)) {
        this.#reportReadFailure({ tenantId, traceIds, error });
        throw new Error("Failed to fetch evaluations for multiple traces");
      }
      return this.#retryWithoutInputs({ client, tenantId, traceIds });
    }
  }

  /**
   * The same read with only the light columns.
   *
   * `Inputs` is the heavy one, and dropping it is what brings a read that hit
   * the server's memory ceiling back inside it. Split out so the first attempt
   * reads as one statement rather than a try nested in a catch.
   */
  async #retryWithoutInputs({
    client,
    tenantId,
    traceIds,
  }: {
    client: Awaited<ReturnType<ClickHouseClientResolver>>;
    tenantId: string;
    traceIds: string[];
  }): Promise<Record<string, TraceEvaluation[]>> {
    logger.warn(
      { tenantId, traceIdCount: traceIds.length },
      "Evaluations read hit the ClickHouse memory limit; retrying without Inputs",
    );
    try {
      const rows = await this.#read({
        client,
        tenantId,
        traceIds,
        columns: EVAL_COLUMNS_LIGHT,
      });
      return this.#groupByTrace(rows, traceIds);
    } catch (error) {
      this.#reportReadFailure({ tenantId, traceIds, error, retried: true });
      throw new Error("Failed to fetch evaluations for multiple traces");
    }
  }

  async #read({
    client,
    tenantId,
    traceIds,
    columns,
  }: {
    client: Awaited<ReturnType<ClickHouseClientResolver>>;
    tenantId: string;
    traceIds: string[];
    columns: string;
  }): Promise<ClickHouseEvaluationRunRow[]> {
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
    retried = false,
  }: {
    tenantId: string;
    traceIds: string[];
    error: unknown;
    retried?: boolean;
  }): void {
    logger.error(
      {
        tenantId,
        traceIdCount: traceIds.length,
        error: error instanceof Error ? error.message : error,
      },
      retried
        ? "Failed to fetch evaluations for multiple traces from ClickHouse after light-projection retry"
        : "Failed to fetch evaluations for multiple traces from ClickHouse",
    );
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
    const client = await this.#resolveOrNull({ tenantId, evaluationId });
    if (!client) return null;

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
      return asPlainObject(safeJsonParse(rows[0]?.Inputs ?? null));
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

  /**
   * An unreachable ClickHouse means "nothing to show" for this read, not a
   * failure worth surfacing - the caller renders an empty inputs panel.
   */
  async #resolveOrNull({
    tenantId,
    evaluationId,
  }: FindInputsByEvaluationIdInput): Promise<Awaited<
    ReturnType<ClickHouseClientResolver>
  > | null> {
    try {
      return await this.resolveClient(tenantId);
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
  }
}

/** A JSON object, or null for anything else - an array, a scalar, a parse failure. */
function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Production default: the standard per-project resolver. */
export function createDefaultTraceEvaluationsRepository(): TraceEvaluationsClickHouseRepository {
  return new TraceEvaluationsClickHouseRepository(
    defaultClickHouseClientResolver,
  );
}
