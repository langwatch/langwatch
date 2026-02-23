import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "~/server/db";
import type { Protections } from "~/server/elasticsearch/protections";
import { ElasticsearchTraceService } from "~/server/traces/elasticsearch-trace.service";
import { mapEsEvaluationToTraceEvaluation } from "./evaluation-run.mappers";
import type { TraceEvaluation } from "./evaluation-run.types";

/**
 * Service for fetching per-trace evaluation states from Elasticsearch.
 *
 * Wraps the existing ElasticsearchTraceService.getEvaluationsMultiple()
 * and maps the legacy Evaluation type to the canonical TraceEvaluation type.
 */
export class ElasticsearchEvaluationService {
  private readonly esTraceService: ElasticsearchTraceService;

  constructor(readonly prisma: PrismaClient) {
    this.esTraceService = ElasticsearchTraceService.create(prisma);
  }

  /**
   * Static factory method for creating ElasticsearchEvaluationService with default dependencies.
   */
  static create(
    prisma: PrismaClient = defaultPrisma,
  ): ElasticsearchEvaluationService {
    return new ElasticsearchEvaluationService(prisma);
  }

  /**
   * Get evaluations for a single trace.
   *
   * Delegates to getEvaluationsMultiple with a single trace ID.
   *
   * @param params.projectId - The project ID
   * @param params.traceId - The trace ID to fetch evaluations for
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
    const result = await this.getEvaluationsMultiple({
      projectId,
      traceIds: [traceId],
      protections,
    });

    return result[traceId] ?? [];
  }

  /**
   * Get evaluations for multiple traces, grouped by trace ID.
   *
   * Queries Elasticsearch via the existing ElasticsearchTraceService and maps
   * the legacy Evaluation type to the canonical TraceEvaluation type.
   *
   * @param params.projectId - The project ID
   * @param params.traceIds - Array of trace IDs to fetch evaluations for
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
    const legacyResult = await this.esTraceService.getEvaluationsMultiple(
      projectId,
      traceIds,
      protections,
    );

    const result: Record<string, TraceEvaluation[]> = {};

    for (const [traceId, evaluations] of Object.entries(legacyResult)) {
      result[traceId] = evaluations.map((evaluation) =>
        mapEsEvaluationToTraceEvaluation(evaluation, traceId),
      );
    }

    return result;
  }
}
