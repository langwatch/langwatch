import crypto from "node:crypto";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import { evaluationNameAutoslug } from "~/server/background/workers/collector/evaluationNameAutoslug";
import type { CompleteEvaluationCommandData, StartEvaluationCommandData } from "../../evaluation-processing/schemas/commands";
import { createLogger } from "../../../../../utils/logger/server";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import { STALE_TRACE_THRESHOLD_MS } from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:custom-evaluation-sync-reactor",
);

export interface CustomEvaluationSyncReactorDeps {
  startEvaluation: (data: StartEvaluationCommandData) => Promise<void>;
  completeEvaluation: (data: CompleteEvaluationCommandData) => Promise<void>;
}

interface SdkEvaluation {
  evaluation_id?: string;
  evaluator_id?: string;
  span_id?: string;
  name: string;
  type?: string;
  is_guardrail?: boolean;
  status?: "processed" | "skipped" | "error";
  passed?: boolean;
  score?: number;
  label?: string;
  details?: string;
  error?: { message: string; stacktrace?: string[] };
  timestamps?: { started_at?: number; finished_at?: number };
}

/**
 * Generates a deterministic evaluation ID by hashing the evaluation JSON.
 * Matches the legacy `mapEvaluations` behavior for idempotency.
 */
function deterministicEvaluationId(evaluation: SdkEvaluation): string {
  const hash = crypto
    .createHash("md5")
    .update(JSON.stringify(evaluation))
    .digest("hex");
  return `eval_md5_${hash}`;
}

function parseEvaluations(raw: string | undefined): SdkEvaluation[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SdkEvaluation =>
        typeof item === "object" &&
        item !== null &&
        "name" in item &&
        typeof (item as Record<string, unknown>).name === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Reactor that syncs custom SDK evaluations to the evaluation-processing pipeline.
 *
 * Fires on the traceSummary fold projection. Reads evaluations from the
 * `langwatch.reserved.evaluations` attribute and sends startEvaluation +
 * completeEvaluation commands for each one. Uses deterministic IDs to
 * ensure idempotency on retries.
 */
export function createCustomEvaluationSyncReactor(
  deps: CustomEvaluationSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "customEvaluationSync",
    options: {
      makeJobId: (payload) =>
        `custom-eval-sync:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 30_000,
      delay: 5_000,
    },

    async handle(
      event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, aggregateId: traceId, foldState } = context;

      // Guard: skip old traces (resyncing)
      if (event.occurredAt < Date.now() - STALE_TRACE_THRESHOLD_MS) return;

      const attrs = foldState.attributes ?? {};
      const rawEvaluations = attrs[ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS];
      const evaluations = parseEvaluations(rawEvaluations);
      if (evaluations.length === 0) return;

      logger.debug(
        { tenantId, traceId, evaluationCount: evaluations.length },
        "Syncing custom SDK evaluations",
      );

      for (const evaluation of evaluations) {
        const evaluationId =
          evaluation.evaluation_id ?? deterministicEvaluationId(evaluation);
        const evaluatorId =
          evaluation.evaluator_id ?? evaluationNameAutoslug(evaluation.name);
        const status =
          evaluation.status ??
          (evaluation.error ? "error" : "processed");
        const occurredAt = event.occurredAt;

        try {
          await deps.startEvaluation({
            tenantId,
            evaluationId,
            evaluatorId,
            evaluatorType: "custom",
            evaluatorName: evaluation.name,
            traceId,
            isGuardrail: evaluation.is_guardrail,
            occurredAt,
          });

          await deps.completeEvaluation({
            tenantId,
            evaluationId,
            status,
            score: evaluation.score ?? null,
            passed: evaluation.passed ?? null,
            label: evaluation.label ?? null,
            details: evaluation.details ?? null,
            error: evaluation.error?.message ?? null,
            occurredAt,
          });
        } catch (error) {
          logger.error(
            {
              tenantId,
              traceId,
              evaluationId,
              evaluatorId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to sync custom evaluation",
          );
        }
      }

      logger.debug(
        { tenantId, traceId, evaluationCount: evaluations.length },
        "Custom SDK evaluations synced",
      );
    },
  };
}
