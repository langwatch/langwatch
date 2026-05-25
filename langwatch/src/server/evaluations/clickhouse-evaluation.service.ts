import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma as defaultPrisma } from "~/server/db";
import type { Protections } from "~/server/elasticsearch/protections";
import { createLogger } from "~/utils/logger/server";
import { safeJsonParse } from "~/utils/safeJsonParse";
import type { ClickHouseEvaluationRunRow } from "./evaluation-run.mappers";
import { mapClickHouseEvaluationToTraceEvaluation } from "./evaluation-run.mappers";
import type { TraceEvaluation } from "./evaluation-run.types";

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

/**
 * Service for fetching per-trace evaluation runs from ClickHouse.
 *
 * Returns null when ClickHouse is not enabled for the project, allowing
 * the caller to fall back to Elasticsearch.
 *
 * Queries the `evaluation_runs` table to collapse
 * ReplacingMergeTree versions.
 */
export class ClickHouseEvaluationService {
  private readonly logger = createLogger(
    "langwatch:evaluations:clickhouse-service",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.evaluations.clickhouse-service",
  );

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Static factory method for creating ClickHouseEvaluationService with default dependencies.
   */
  static create(
    prisma: PrismaClient = defaultPrisma,
  ): ClickHouseEvaluationService {
    return new ClickHouseEvaluationService(prisma);
  }

  /**
   * Get evaluations for a single trace.
   *
   * Returns null if ClickHouse is not enabled for the project.
   *
   * @param params.projectId - The project (tenant) ID
   * @param params.traceId - The trace ID to fetch evaluations for
   * @returns Array of TraceEvaluation, or null if CH is not enabled
   */
  async getEvaluationsForTrace({
    projectId,
    traceId,
    protections: _protections,
  }: {
    projectId: string;
    traceId: string;
    protections?: Protections;
  }): Promise<TraceEvaluation[] | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseEvaluationService.getEvaluationsForTrace",
      { attributes: { "tenant.id": projectId, "trace.id": traceId } },
      async () => {
        const clickHouseClient = await getClickHouseClientForProject(projectId);
        if (!clickHouseClient) {
          return null;
        }

        this.logger.debug(
          { projectId, traceId },
          "Fetching evaluations for trace from ClickHouse",
        );

        const runQuery = async (columns: string) => {
          const result = await clickHouseClient.query({
            query: `
              SELECT ${columns}
              FROM evaluation_runs
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
                AND (TenantId, EvaluationId, UpdatedAt) IN (
                  SELECT TenantId, EvaluationId, max(UpdatedAt)
                  FROM evaluation_runs
                  WHERE TenantId = {tenantId:String}
                    AND TraceId = {traceId:String}
                  GROUP BY TenantId, EvaluationId
                )
            `,
            query_params: { tenantId: projectId, traceId },
            format: "JSONEachRow",
          });
          return (await result.json()) as ClickHouseEvaluationRunRow[];
        };

        try {
          const rows = await runQuery(EVAL_COLUMNS_WITH_INPUTS);
          return rows.map(mapClickHouseEvaluationToTraceEvaluation);
        } catch (error) {
          if (isMemoryLimitError(error)) {
            // Heavy `Inputs` blobs blew the memory ceiling — retry without
            // them so the operator still sees verdicts/scores instead of a
            // 500. The eval card hides its inputs section when absent.
            this.logger.warn(
              { projectId, traceId },
              "Evaluations read hit the ClickHouse memory limit; retrying without Inputs",
            );
            try {
              const rows = await runQuery(EVAL_COLUMNS_LIGHT);
              return rows.map(mapClickHouseEvaluationToTraceEvaluation);
            } catch (retryError) {
              this.logger.error(
                {
                  projectId,
                  traceId,
                  error:
                    retryError instanceof Error
                      ? retryError.message
                      : retryError,
                },
                "Failed to fetch evaluations for trace from ClickHouse after light-projection retry",
              );
              throw new Error("Failed to fetch evaluations for trace");
            }
          }
          this.logger.error(
            {
              projectId,
              traceId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch evaluations for trace from ClickHouse",
          );
          throw new Error("Failed to fetch evaluations for trace");
        }
      },
    );
  }

  /**
   * Get evaluations for multiple traces, grouped by trace ID.
   *
   * Returns null if ClickHouse is not enabled for the project.
   *
   * @param params.projectId - The project (tenant) ID
   * @param params.traceIds - Array of trace IDs to fetch evaluations for
   * @returns Record mapping traceId to TraceEvaluation[], or null if CH is not enabled
   */
  async getEvaluationsMultiple({
    projectId,
    traceIds,
    protections: _protections,
  }: {
    projectId: string;
    traceIds: string[];
    protections?: Protections;
  }): Promise<Record<string, TraceEvaluation[]> | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseEvaluationService.getEvaluationsMultiple",
      {
        attributes: {
          "tenant.id": projectId,
          "trace.count": traceIds.length,
        },
      },
      async () => {
        const clickHouseClient = await getClickHouseClientForProject(projectId);
        if (!clickHouseClient) {
          return null;
        }

        if (traceIds.length === 0) {
          return {};
        }

        this.logger.debug(
          { projectId, traceIdCount: traceIds.length },
          "Fetching evaluations for multiple traces from ClickHouse",
        );

        const runQuery = async (columns: string) => {
          const result = await clickHouseClient.query({
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
            query_params: { tenantId: projectId, traceIds },
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
              grouped[traceId]!.push(
                mapClickHouseEvaluationToTraceEvaluation(row),
              );
            }
          }
          return grouped;
        };

        try {
          return groupByTrace(await runQuery(EVAL_COLUMNS_WITH_INPUTS));
        } catch (error) {
          if (isMemoryLimitError(error)) {
            // Heavy `Inputs` blobs blew the memory ceiling — retry without
            // them so the operator still sees verdicts/scores instead of a
            // 500. The eval card hides its inputs section when absent.
            this.logger.warn(
              { projectId, traceIdCount: traceIds.length },
              "Evaluations read hit the ClickHouse memory limit; retrying without Inputs",
            );
            try {
              return groupByTrace(await runQuery(EVAL_COLUMNS_LIGHT));
            } catch (retryError) {
              this.logger.error(
                {
                  projectId,
                  traceIdCount: traceIds.length,
                  error:
                    retryError instanceof Error
                      ? retryError.message
                      : retryError,
                },
                "Failed to fetch evaluations for multiple traces from ClickHouse after light-projection retry",
              );
              throw new Error("Failed to fetch evaluations for multiple traces");
            }
          }
          this.logger.error(
            {
              projectId,
              traceIdCount: traceIds.length,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch evaluations for multiple traces from ClickHouse",
          );
          throw new Error("Failed to fetch evaluations for multiple traces");
        }
      },
    );
  }

  /**
   * Fetch the heavy `Inputs` blob for one evaluation, on demand.
   *
   * The list reads (`getEvaluationsForTrace` / `getEvaluationsMultiple`) drop
   * `Inputs` under memory pressure because a `TraceId` filter can't prune
   * granules, so the heavy column is read across every granule the tenant
   * touches. This read is keyed by `EvaluationId` — the table's second sort
   * column — so ClickHouse prunes to the matching granule(s) and the read
   * stays bounded. The drawer calls it lazily when a single evaluation is
   * expanded. Returns null when ClickHouse is not enabled, the evaluation
   * recorded no inputs, or the (already-pruned) read still hits the ceiling.
   */
  async getEvaluationInputs({
    projectId,
    evaluationId,
  }: {
    projectId: string;
    evaluationId: string;
    protections?: Protections;
  }): Promise<Record<string, unknown> | null> {
    return await this.tracer.withActiveSpan(
      "ClickHouseEvaluationService.getEvaluationInputs",
      {
        attributes: {
          "tenant.id": projectId,
          "evaluation.id": evaluationId,
        },
      },
      async () => {
        const clickHouseClient = await getClickHouseClientForProject(projectId);
        if (!clickHouseClient) {
          return null;
        }

        try {
          const result = await clickHouseClient.query({
            query: `
              SELECT argMax(Inputs, UpdatedAt) AS Inputs
              FROM evaluation_runs
              WHERE TenantId = {tenantId:String}
                AND EvaluationId = {evaluationId:String}
            `,
            query_params: { tenantId: projectId, evaluationId },
            format: "JSONEachRow",
          });
          const rows = (await result.json()) as { Inputs: string | null }[];
          const parsed = safeJsonParse(rows[0]?.Inputs ?? null);
          return parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
        } catch (error) {
          if (isMemoryLimitError(error)) {
            // Even pruned to one evaluation the granule was too heavy. Degrade
            // to "no inputs" rather than surfacing a 500 — the verdict already
            // rendered from the list query.
            this.logger.warn(
              { projectId, evaluationId },
              "Evaluation inputs read hit the ClickHouse memory limit even when keyed by EvaluationId",
            );
            return null;
          }
          this.logger.error(
            {
              projectId,
              evaluationId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch evaluation inputs from ClickHouse",
          );
          throw new Error("Failed to fetch evaluation inputs");
        }
      },
    );
  }
}
