import crypto from "node:crypto";
import { createLogger } from "@langwatch/observability";
import { evaluationNameAutoslug } from "~/server/tracer/collector/evaluationNameAutoslug";
import type { TriggerContext } from "../../../pipeline/processManagerDefinition";
import type { ReportEvaluationCommandData } from "../../evaluation-processing/schemas/commands";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import { STALE_TRACE_THRESHOLD_MS } from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";
import { isSpanReceivedEvent } from "../schemas/events";
import type { OtlpSpan } from "../schemas/otlp";

const logger = createLogger(
  "langwatch:trace-processing:custom-evaluation-sync",
);

export const CUSTOM_EVAL_SYNC_DELAY_MS = 5_000;
export const CUSTOM_EVAL_SYNC_DEDUP_TTL_MS = 30_000;

export function customEvaluationSyncDedupId(
  event: TraceProcessingEvent,
): string {
  return `${event.tenantId}:${event.aggregateId}:${event.id}`;
}

export interface CustomEvaluationSyncSubscriberDeps {
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
  cost_id?: string;
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
 * Cheap presence check — no JSON.parse. The predicate runs on the projection
 * hot path with attacker-supplied span payloads, so it only looks for an
 * evaluation event carrying a string payload; full parsing and validation
 * stay in the handler off the hot path.
 */
function spanHasEvaluationEvents(span: OtlpSpan): boolean {
  return (span.events ?? []).some(
    (event) =>
      event.name === EVAL_EVENT_NAME &&
      event.attributes.some(
        (attr) =>
          attr.key === "json_encoded_event" &&
          attr.value !== undefined &&
          "stringValue" in attr.value,
      ),
  );
}

/**
 * Total, non-throwing relevance guard. As the subscriber's `when` it is
 * evaluated both pre-enqueue (a filtered event never pays serialization) and
 * again in the handler on the fail-open path: only span events that are
 * recent (not a resync) and actually carry `langwatch.evaluation.custom`
 * events need this subscriber.
 */
export function hasSyncableEvaluations(event: TraceProcessingEvent): boolean {
  if (!isSpanReceivedEvent(event)) return false;
  if (event.occurredAt < Date.now() - STALE_TRACE_THRESHOLD_MS) return false;
  return spanHasEvaluationEvents(event.data.span);
}

/**
 * Subscriber handler that syncs custom SDK evaluations to the
 * evaluation-processing pipeline.
 *
 * Reads `langwatch.evaluation.custom` events directly from each
 * SpanReceivedEvent's OTLP span data, then dispatches a single
 * reportEvaluation command that emits both started and completed events
 * atomically. Uses deterministic IDs for idempotency on retries.
 */
export function createCustomEvaluationSyncHandler(
  deps: CustomEvaluationSyncSubscriberDeps,
): (
  event: TraceProcessingEvent,
  context: TriggerContext<TraceSummaryData>,
) => Promise<void> {
  return async (event, context) => {
    if (!hasSyncableEvaluations(event) || !isSpanReceivedEvent(event)) return;

    const { tenantId, aggregateId: traceId } = context;

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
        evaluation.status ?? (evaluation.error ? "error" : "processed");
      // A verdict is only real when the evaluator ran to completion — an
      // errored/skipped run's stray passed/score/label must not reach
      // analytics or triggers as a real result (#6833). Same gate as the shared
      // verdictGate helpers now applied at the executeEvaluation command boundary.
      const hasVerdict = status === "processed";
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
          score: hasVerdict ? (evaluation.score ?? null) : null,
          passed: hasVerdict ? (evaluation.passed ?? null) : null,
          label: hasVerdict ? (evaluation.label ?? null) : null,
          details: evaluation.details ?? null,
          error: evaluation.error?.message ?? null,
          errorDetails: evaluation.error?.stacktrace?.join("\n") ?? null,
          costId: evaluation.cost_id ?? null,
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
      {
        tenantId,
        traceId,
        evaluationCount: evaluations.length,
        failedCount: errors.length,
      },
      "Custom SDK evaluations synced",
    );

    if (errors.length > 0) {
      throw errors[0];
    }
  };
}
