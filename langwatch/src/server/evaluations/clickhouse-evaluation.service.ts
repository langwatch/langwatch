import type { ClickHouseClient } from "@clickhouse/client";
import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { prisma as defaultPrisma } from "~/server/db";
import type { Protections } from "~/server/elasticsearch/protections";
import { createLogger } from "~/utils/logger/server";
import type { ClickHouseEvaluationRunRow } from "./evaluation-run.mappers";
import { mapClickHouseEvaluationToTraceEvaluation } from "./evaluation-run.mappers";
import type { TraceEvaluation } from "./evaluation-run.types";
import { isClickHouseReadEnabled } from "~/server/evaluations-v3/services/isClickHouseReadEnabled";

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
  private readonly clickHouseClient: ClickHouseClient | null;
  private readonly logger = createLogger(
    "langwatch:evaluations:clickhouse-service",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.evaluations.clickhouse-service",
  );

  constructor(private readonly prisma: PrismaClient) {
    this.clickHouseClient = getClickHouseClient();
  }

  /**
   * Static factory method for creating ClickHouseEvaluationService with default dependencies.
   */
  static create(
    prisma: PrismaClient = defaultPrisma,
  ): ClickHouseEvaluationService {
    return new ClickHouseEvaluationService(prisma);
  }

  /**
   * Check if ClickHouse evaluations data source is enabled for the given project.
   */
  async isClickHouseEnabled(projectId: string): Promise<boolean> {
    return await this.tracer.withActiveSpan(
      "ClickHouseEvaluationService.isClickHouseEnabled",
      { attributes: { "tenant.id": projectId } },
      async (span) => {
        if (!this.clickHouseClient) {
          return false;
        }

        const enabled = await isClickHouseReadEnabled(this.prisma, projectId);

        span.setAttribute(
          "project.feature.clickhouse.evaluations",
          enabled,
        );

        return enabled;
      },
    );
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
        const isEnabled = await this.isClickHouseEnabled(projectId);
        if (!isEnabled || !this.clickHouseClient) {
          return null;
        }

        this.logger.debug(
          { projectId, traceId },
          "Fetching evaluations for trace from ClickHouse",
        );

        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT *
              FROM evaluation_runs
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
              ORDER BY EvaluationId, UpdatedAt DESC
              LIMIT 1 BY TenantId, EvaluationId
            `,
            query_params: {
              tenantId: projectId,
              traceId,
            },
            format: "JSONEachRow",
          });

          const rows =
            (await result.json()) as ClickHouseEvaluationRunRow[];

          return rows.map(mapClickHouseEvaluationToTraceEvaluation);
        } catch (error) {
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
        const isEnabled = await this.isClickHouseEnabled(projectId);
        if (!isEnabled || !this.clickHouseClient) {
          return null;
        }

        if (traceIds.length === 0) {
          return {};
        }

        this.logger.debug(
          { projectId, traceIdCount: traceIds.length },
          "Fetching evaluations for multiple traces from ClickHouse",
        );

        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT *
              FROM evaluation_runs
              WHERE TenantId = {tenantId:String}
                AND TraceId IN ({traceIds:Array(String)})
              ORDER BY EvaluationId, UpdatedAt DESC
              LIMIT 1 BY TenantId, EvaluationId
            `,
            query_params: {
              tenantId: projectId,
              traceIds,
            },
            format: "JSONEachRow",
          });

          const rows =
            (await result.json()) as ClickHouseEvaluationRunRow[];

          // Group by TraceId
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
        } catch (error) {
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
}
