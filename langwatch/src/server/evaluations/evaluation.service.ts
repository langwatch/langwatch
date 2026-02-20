import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "~/server/db";
import type { Protections } from "~/server/elasticsearch/protections";
import { createLogger } from "~/utils/logger/server";
import { ClickHouseEvaluationService } from "./clickhouse-evaluation.service";
import { ElasticsearchEvaluationService } from "./elasticsearch-evaluation.service";
import type { TraceEvaluation } from "./evaluation-run.types";

/**
 * Unified service for fetching per-trace evaluation runs from either
 * ClickHouse or Elasticsearch.
 *
 * This service acts as a facade that:
 * 1. Checks if ClickHouse Evaluations Data Source is enabled for the project
 *    (via featureClickHouseDataSourceEvaluations flag)
 * 2. Routes requests to the appropriate backend based on the feature flag
 *
 * When ClickHouse is the exclusive source (flag on), only CH is queried.
 * When ES is the primary source (flag off), ES results are merged with any
 * CH evaluations (from the event-sourcing path) so new evaluations appear
 * immediately without dual-writing to ES.
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
   * Routes to ClickHouse when enabled, Elasticsearch otherwise.
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
              protections,
            });
          if (result === null) {
            throw new Error(
              "ClickHouse is enabled but returned null for getEvaluationsForTrace — check ClickHouse client configuration",
            );
          }
          return result;
        }

        // ES path: merge ES evaluations with any CH evaluations from event-sourcing
        const [esResult, chResult] = await Promise.all([
          this.elasticsearchService.getEvaluationsForTrace({
            projectId,
            traceId,
            protections,
          }),
          this.clickHouseService
            .getEvaluationsForTrace({ projectId, traceId, protections })
            .catch((err) => {
              this.logger.warn(
                { err, projectId, traceId },
                "CH query failed during ES-primary merge for getEvaluationsForTrace",
              );
              return null;
            }),
        ]);

        return mergeEvaluations(esResult, chResult ?? []);
      },
    );
  }

  /**
   * Get evaluations for multiple traces, grouped by trace ID.
   *
   * Routes to ClickHouse when enabled, Elasticsearch otherwise.
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
              protections,
            });
          if (result === null) {
            throw new Error(
              "ClickHouse is enabled but returned null for getEvaluationsMultiple — check ClickHouse client configuration",
            );
          }
          return result;
        }

        // ES path: merge ES evaluations with any CH evaluations from event-sourcing
        const [esResult, chResult] = await Promise.all([
          this.elasticsearchService.getEvaluationsMultiple({
            projectId,
            traceIds,
            protections,
          }),
          this.clickHouseService
            .getEvaluationsMultiple({ projectId, traceIds, protections })
            .catch((err) => {
              this.logger.warn(
                { err, projectId, traceIdCount: traceIds.length },
                "CH query failed during ES-primary merge for getEvaluationsMultiple",
              );
              return null;
            }),
        ]);

        if (!chResult) return esResult;

        const merged: Record<string, TraceEvaluation[]> = {};
        const allTraceIds = new Set([
          ...Object.keys(esResult),
          ...Object.keys(chResult),
        ]);
        for (const traceId of allTraceIds) {
          merged[traceId] = mergeEvaluations(
            esResult[traceId] ?? [],
            chResult[traceId] ?? [],
          );
        }
        return merged;
      },
    );
  }
}

/**
 * Merge evaluations from ES and CH. CH wins on duplicate evaluationId.
 * This allows the event-sourcing path to write only to CH while
 * the read side transparently merges both sources.
 */
function mergeEvaluations(
  esEvaluations: TraceEvaluation[],
  chEvaluations: TraceEvaluation[],
): TraceEvaluation[] {
  if (chEvaluations.length === 0) return esEvaluations;
  if (esEvaluations.length === 0) return chEvaluations;

  const chIds = new Set(chEvaluations.map((e) => e.evaluationId));
  const fromEs = esEvaluations.filter((e) => !chIds.has(e.evaluationId));
  return [...fromEs, ...chEvaluations];
}
