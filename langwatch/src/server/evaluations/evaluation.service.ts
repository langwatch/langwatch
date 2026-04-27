import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "~/server/db";
import type { Protections } from "~/server/elasticsearch/protections";
import { createLogger } from "~/utils/logger/server";
import { ClickHouseEvaluationService } from "./clickhouse-evaluation.service";
import { ElasticsearchEvaluationService } from "./elasticsearch-evaluation.service";
import type { TraceEvaluation } from "./evaluation-run.types";

/**
 * Unified service for fetching per-trace evaluation runs from ClickHouse.
 *
 * This service acts as a facade that routes all requests to the ClickHouse backend.
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
  private readonly tracer = getLangWatchTracer(
    "langwatch.evaluations.service",
  );
  private readonly logger = createLogger("langwatch:evaluations:service");

  constructor(private readonly prisma: PrismaClient) {
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
   * Get evaluations for a single trace.
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
        span.setAttribute("backend", "clickhouse");

        const result =
          await this.clickHouseService.getEvaluationsForTrace({
            projectId,
            traceId,
            protections,
          });
        if (result === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for getEvaluationsForTrace — check ClickHouse client configuration",
          );
        }
        return result;
      },
    );
  }

  /**
   * Get evaluations for multiple traces, grouped by trace ID.
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
        span.setAttribute("backend", "clickhouse");

        const result =
          await this.clickHouseService.getEvaluationsMultiple({
            projectId,
            traceIds,
            protections,
          });
        if (result === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for getEvaluationsMultiple — check ClickHouse client configuration",
          );
        }
        return result;
      },
    );
  }
}
