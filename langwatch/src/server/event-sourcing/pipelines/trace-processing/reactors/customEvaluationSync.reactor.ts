import crypto from "node:crypto";
import { evaluationNameAutoslug } from "~/server/background/workers/collector/evaluationNameAutoslug";
import type { ReportEvaluationCommandData } from "../../evaluation-processing/schemas/commands";
import { createLogger } from "../../../../../utils/logger/server";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import { STALE_TRACE_THRESHOLD_MS } from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";
import { isSpanReceivedEvent } from "../schemas/events";
import type { OtlpSpan } from "../schemas/otlp";

const logger = createLogger(
  "langwatch:trace-processing:custom-evaluation-sync-reactor",
);

export interface CustomEvaluationSyncReactorDeps {
  reportEvaluation: (data: ReportEvaluationCommandData) => Promise<void>;
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
function deterministicEvaluationId({
  traceId,
  evaluation,
}: {
  traceId: string;
  evaluation: SdkEvaluation;
}): string {
  const hash = crypto
    .createHash("md5")
    .update(JSON.stringify({ traceId, evaluation }))
    .digest("hex");
  return `eval_md5_${hash}`;
}

const EVAL_EVENT_NAME = "langwatch.evaluation.custom";

/**
 * Extracts SDK evaluations directly from OTLP span events.
 *
 * Reads `langwatch.evaluation.custom` events from the raw OTLP span,
 * parses the `json_encoded_event` attribute from each.
 */
export function extractEvaluationsFromSpan(span: OtlpSpan): SdkEvaluation[] {
  const evaluations: SdkEvaluation[] = [];

  for (const event of span.events ?? []) {
    if (event.name !== EVAL_EVENT_NAME) continue;

    const jsonAttr = event.attributes.find(
      (attr) => attr.key === "json_encoded_event",
    );
    const jsonPayload =
      jsonAttr?.value && "stringValue" in jsonAttr.value
        ? jsonAttr.value.stringValue
        : undefined;
    if (typeof jsonPayload !== "string") continue;

    try {
      const parsed: unknown = JSON.parse(jsonPayload);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      )
        continue;
      const record = parsed as Record<string, unknown>;
      if (typeof record.name !== "string") continue;
      evaluations.push(record as unknown as SdkEvaluation);
    } catch {
      logger.warn(
        { payloadLength: jsonPayload.length },
        "Failed to parse json_encoded_event from evaluation span event",
      );
    }
  }

  return evaluations;
}

/**
 * Reactor that syncs custom SDK evaluations to the evaluation-processing pipeline.
 *
 * Reads `langwatch.evaluation.custom` events directly from each SpanReceivedEvent's
 * OTLP span data, then dispatches a single reportEvaluation command that emits
 * both started and completed events atomically.
 * Uses deterministic IDs for idempotency on retries.
 */
export function createCustomEvaluationSyncReactor(
  deps: CustomEvaluationSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "customEvaluationSync",
    options: {
      makeJobId: (payload) =>
        `custom-eval-sync:${payload.event.tenantId}:${payload.event.aggregateId}:${payload.event.id}`,
      ttl: 30_000,
      delay: 5_000,
    },

    async handle(
      event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      if (!isSpanReceivedEvent(event)) return;

      const { tenantId, aggregateId: traceId } = context;

      // Guard: skip old traces (resyncing)
      if (event.occurredAt < Date.now() - STALE_TRACE_THRESHOLD_MS) return;

      const evaluations = extractEvaluationsFromSpan(event.data.span);
      if (evaluations.length === 0) return;

      logger.debug(
        { tenantId, traceId, evaluationCount: evaluations.length },
        "Syncing custom SDK evaluations",
      );

      const errors: Error[] = [];

      for (const evaluation of evaluations) {
        const evaluationId =
          evaluation.evaluation_id ??
          deterministicEvaluationId({ traceId, evaluation });
        const evaluatorId =
          evaluation.evaluator_id ?? evaluationNameAutoslug(evaluation.name);
        const status =
          evaluation.status ??
          (evaluation.error ? "error" : "processed");
        const occurredAt = event.occurredAt;

        try {
          await deps.reportEvaluation({
            tenantId,
            evaluationId,
            evaluatorId,
            evaluatorType: "custom",
            evaluatorName: evaluation.name,
            traceId,
            isGuardrail: evaluation.is_guardrail ?? undefined,
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
          errors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }

      logger.debug(
        { tenantId, traceId, evaluationCount: evaluations.length, failedCount: errors.length },
        "Custom SDK evaluations synced",
      );

      if (errors.length > 0) {
        throw errors[0];
      }
    },
  };
}
