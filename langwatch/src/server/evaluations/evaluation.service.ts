import { createLogger } from "@langwatch/observability";
import { getLangWatchTracer } from "langwatch";
import { resolveInputsMarker } from "~/server/app-layer/evaluations/evaluation-inputs-offload";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import type { Protections } from "~/server/traces/protections";
import { safeJsonParse } from "~/utils/safeJsonParse";
import type { ClickHouseEvaluationRunRow } from "./evaluation-run.mappers";
import { mapClickHouseEvaluationToTraceEvaluation } from "./evaluation-run.mappers";
import type { TraceEvaluation } from "./evaluation-run.types";

/**
 * Resolves an offloaded-inputs marker (ADR-040) back to the full inputs at the
 * read boundary. The production default builds a per-project stored-objects
 * service and streams the durable object; a plain (non-marker) object passes
 * through unchanged. Injected so tests can supply a stub without standing up
 * object storage.
 */
export type ResolveEvaluationInputsMarker = (args: {
  projectId: string;
  inputs: Record<string, unknown> | null;
}) => Promise<Record<string, unknown> | null>;

const defaultResolveInputsMarker: ResolveEvaluationInputsMarker = ({
  projectId,
  inputs,
}) =>
  resolveInputsMarker({
    projectId,
    inputs,
    storedObjects: createStoredObjectsService({ projectId }),
  });

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
 * Queries `evaluation_runs` and collapses ReplacingMergeTree versions.
 */
export class EvaluationService {
  private readonly logger = createLogger("langwatch:evaluations:service");
  private readonly tracer = getLangWatchTracer("langwatch.evaluations.service");
  private readonly resolveInputsMarker: ResolveEvaluationInputsMarker;

  constructor(resolveInputsMarkerFn: ResolveEvaluationInputsMarker = defaultResolveInputsMarker) {
    this.resolveInputsMarker = resolveInputsMarkerFn;
  }

  static create(): EvaluationService {
    return new EvaluationService();
  }

  async getEvaluationsForTrace({
    projectId,
    traceId,
    protections,
  }: {
    projectId: string;
    traceId: string;
    protections?: Protections;
  }): Promise<TraceEvaluation[]> {
    // Single-trace read is the multi-trace read with one id — keeps the
    // query shape and the memory-limit fallback policy in one place.
    const evaluationsByTrace = await this.getEvaluationsMultiple({
      projectId,
      traceIds: [traceId],
      protections,
    });
    return evaluationsByTrace[traceId] ?? [];
  }

  async getEvaluationsMultiple({
    projectId,
    traceIds,
    protections: _protections,
  }: {
    projectId: string;
    traceIds: string[];
    protections?: Protections;
  }): Promise<Record<string, TraceEvaluation[]>> {
    return await this.tracer.withActiveSpan(
      "EvaluationService.getEvaluationsMultiple",
      {
        attributes: {
          "tenant.id": projectId,
          "trace.count": traceIds.length,
        },
      },
      async () => {
        const clickHouseClient = await getClickHouseClientForProject(projectId);
        if (!clickHouseClient) {
          throw new Error(
            `ClickHouse client unavailable for project ${projectId}`,
          );
        }

        if (traceIds.length === 0) {
          return {};
        }

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
              throw new Error(
                "Failed to fetch evaluations for multiple traces",
              );
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
   * The list reads drop `Inputs` under memory pressure because a `TraceId`
   * filter can't prune granules. This read is keyed by `EvaluationId` — the
   * table's second sort column — so ClickHouse prunes to the matching
   * granule(s) and the read stays bounded. Returns null when the evaluation
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
      "EvaluationService.getEvaluationInputs",
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
          const inputs =
            parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : null;
          // ADR-040: when inputs were offloaded, `parsed` is a stored-object
          // marker. Resolve it to the full inputs here - the natural lazy seam
          // the UI already fetches through - so the caller cannot tell whether
          // the inputs were inline or offloaded. Non-markers pass through.
          return this.resolveInputsMarker({ projectId, inputs });
        } catch (error) {
          if (isMemoryLimitError(error)) {
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
