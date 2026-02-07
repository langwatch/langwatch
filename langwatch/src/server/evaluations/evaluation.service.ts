import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "~/server/db";
import type { Protections } from "~/server/elasticsearch/protections";
import { createLogger } from "~/utils/logger/server";
import { ClickHouseEvaluationService } from "./clickhouse-evaluation.service";
import { ElasticsearchEvaluationService } from "./elasticsearch-evaluation.service";
import type { TraceEvaluation } from "./evaluation-state.types";

/**
 * Unified service for fetching per-trace evaluation states from either
 * ClickHouse or Elasticsearch.
 *
 * This service acts as a facade that:
 * 1. Checks if ClickHouse Evaluations Data Source is enabled for the project
 *    (via featureClickHouseDataSourceEvaluations flag)
 * 2. Routes requests to the appropriate backend based on the feature flag
 * 3. Falls back to Elasticsearch when ClickHouse returns null (not enabled)
 *
 * @example
 * ```ts
 * const service = EvaluationService.create(prisma);
 * const evaluations = await service.getEvaluationsForTrace({
 *   projectId: "proj_123",
 *   traceId: "trace_abc",
 *   protections: { canSeeCosts: true },
 * });
 * ```
 */
export class EvaluationService {
  private readonly clickHouseService: ClickHouseEvaluationService;
  private readonly elasticsearchService: ElasticsearchEvaluationService;
  private readonly logger = createLogger("langwatch:evaluations:service");
  private readonly tracer = getLangWatchTracer(
    "langwatch.evaluations.service",
  );

  constructor(readonly prisma: PrismaClient) {
    this.clickHouseService = ClickHouseEvaluationService.create(prisma);
    this.elasticsearchService =
      ElasticsearchEvaluationService.create(prisma);
  }

  /**
   * Static factory method for creating EvaluationService with default dependencies.
   *
   * @param prisma - PrismaClient instance
   * @returns EvaluationService instance
   */
  static create(prisma: PrismaClient = defaultPrisma): EvaluationService {
    return new EvaluationService(prisma);
  }

  /**
   * Check if ClickHouse evaluations data source is enabled for the given project.
   *
   * @param projectId - The project ID
   * @returns True if ClickHouse is enabled, false otherwise
   */
  async isClickHouseEnabled(projectId: string): Promise<boolean> {
    return this.clickHouseService.isClickHouseEnabled(projectId);
  }

  /**
   * Get evaluations for a single trace.
   *
   * Checks the ClickHouse feature flag first. If CH returns data, uses it;
   * if CH returns null (not enabled), falls back to Elasticsearch.
   *
   * @param params.projectId - The project ID
   * @param params.traceId - The trace ID
   * @param params.protections - Field redaction protections
   * @returns Array of TraceEvaluation
   */
  async getEvaluationsForTrace({
    projectId,
    traceId,
    protections,
  }: {
    projectId: string;
    traceId: string;
    protections: Protections;
  }): Promise<TraceEvaluation[]> {
    return this.tracer.withActiveSpan(
      "EvaluationService.getEvaluationsForTrace",
      { attributes: { "tenant.id": projectId, "trace.id": traceId } },
      async (span) => {
        const useClickHouse = await this.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result =
            await this.clickHouseService.getEvaluationsForTrace({
              projectId,
              traceId,
            });
          if (result !== null) {
            return result;
          }
          this.logger.warn(
            { projectId, traceId },
            "ClickHouse enabled but returned null for getEvaluationsForTrace, falling back to Elasticsearch",
          );
        }

        return this.elasticsearchService.getEvaluationsForTrace({
          projectId,
          traceId,
          protections,
        });
      },
    );
  }

  /**
   * Get evaluations for multiple traces, grouped by trace ID.
   *
   * Checks the ClickHouse feature flag first. If CH returns data, uses it;
   * if CH returns null (not enabled), falls back to Elasticsearch.
   *
   * @param params.projectId - The project ID
   * @param params.traceIds - Array of trace IDs
   * @param params.protections - Field redaction protections
   * @returns Record mapping traceId to TraceEvaluation[]
   */
  async getEvaluationsMultiple({
    projectId,
    traceIds,
    protections,
  }: {
    projectId: string;
    traceIds: string[];
    protections: Protections;
  }): Promise<Record<string, TraceEvaluation[]>> {
    return this.tracer.withActiveSpan(
      "EvaluationService.getEvaluationsMultiple",
      {
        attributes: {
          "tenant.id": projectId,
          "trace.count": traceIds.length,
        },
      },
      async (span) => {
        const useClickHouse = await this.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result =
            await this.clickHouseService.getEvaluationsMultiple({
              projectId,
              traceIds,
            });
          if (result !== null) {
            return result;
          }
          this.logger.warn(
            { projectId, traceIdCount: traceIds.length },
            "ClickHouse enabled but returned null for getEvaluationsMultiple, falling back to Elasticsearch",
          );
        }

        return this.elasticsearchService.getEvaluationsMultiple({
          projectId,
          traceIds,
          protections,
        });
      },
    );
  }
}
