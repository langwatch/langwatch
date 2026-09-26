/**
 * Customer-reported evaluations, read back out of spans. Counterpart to
 * {@link createTrackedEventSyncHandler}: derived ids so redelivery replaces rather than
 * duplicates, and a payload that must parse before anything is reported.
 */

import crypto from "node:crypto";

import type { ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  type TraceSummaryData,
  isSpanReceivedEvent,
  type TraceProcessingEvent,
  type OtlpSpan,
  type SdkEvaluation,
  sdkEvaluationSchema,
  STALE_TRACE_THRESHOLD_MS,
} from "@langwatch/trace-contract";

const logger = createLogger("langwatch:trace-processing:custom-evaluation-sync");

export const CUSTOM_EVAL_SYNC_DELAY_MS = 5_000;
export const CUSTOM_EVAL_SYNC_DEDUP_TTL_MS = 30_000;

export interface CustomEvaluationSyncSubscriberDeps {
  reportEvaluation: (data: ReportEvaluationCommandData) => Promise<void>;
  /**
   * The evaluator id an SDK evaluation gets when it names no `evaluator_id`.
   * Evaluation owns the slug rule, injected rather than restated here — a
   * Trace-local copy would drift and silently re-key every derived evaluator.
   */
  deriveEvaluatorId: (evaluationName: string) => string;
}

const EVAL_EVENT_NAME = "langwatch.evaluation.custom";

type OtlpSpanEvent = NonNullable<OtlpSpan["events"]>[number];

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

function readEvaluationPayload(event: OtlpSpanEvent): string | undefined {
  if (event.name !== EVAL_EVENT_NAME) return undefined;
  const jsonAttr = event.attributes.find((attr) => attr.key === "json_encoded_event");
  return jsonAttr?.value && "stringValue" in jsonAttr.value
    ? (jsonAttr.value.stringValue ?? undefined)
    : undefined;
}

function parseEvaluation(jsonPayload: string): SdkEvaluation | undefined {
  try {
    const result = sdkEvaluationSchema.safeParse(JSON.parse(jsonPayload));
    return result.success ? result.data : undefined;
  } catch {
    logger.warn(
      { payloadLength: jsonPayload.length },
      "Failed to parse json_encoded_event from evaluation span event",
    );
    return undefined;
  }
}

/**
 * Cheap presence check — no JSON.parse. Runs on the projection hot path
 * with attacker-supplied payloads, so it only looks for an evaluation
 * event carrying a string payload; parsing stays in the handler.
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
 * Reports every evaluation before surfacing failures, so one broken
 * evaluation cannot block the rest of the span's evaluations.
 */
async function reportEvaluations({
  deps,
  tenantId,
  traceId,
  evaluations,
  occurredAt,
}: {
  deps: CustomEvaluationSyncSubscriberDeps;
  tenantId: string;
  traceId: string;
  evaluations: SdkEvaluation[];
  occurredAt: number;
}): Promise<Error[]> {
  const errors: Error[] = [];
  for (const evaluation of evaluations) {
    const failure = await reportOneEvaluation({
      deps,
      tenantId,
      traceId,
      evaluation,
      occurredAt,
    });
    if (failure) errors.push(failure);
  }
  return errors;
}

/**
 * A verdict is only real when the evaluator ran to completion — an
 * errored/skipped run's stray passed/score/label must not reach analytics
 * or triggers as a real result (#6833). Same gate as verdictGate.
 */
function verdictFields(evaluation: SdkEvaluation, hasVerdict: boolean) {
  return {
    score: hasVerdict ? (evaluation.score ?? null) : null,
    passed: hasVerdict ? (evaluation.passed ?? null) : null,
    label: hasVerdict ? (evaluation.label ?? null) : null,
  };
}

function buildReportPayload({
  tenantId,
  traceId,
  evaluation,
  occurredAt,
  deriveEvaluatorId,
}: {
  tenantId: string;
  traceId: string;
  evaluation: SdkEvaluation;
  occurredAt: number;
  deriveEvaluatorId: CustomEvaluationSyncSubscriberDeps["deriveEvaluatorId"];
}): ReportEvaluationCommandData {
  const status = evaluation.status ?? (evaluation.error ? "error" : "processed");

  return {
    tenantId,
    evaluationId: evaluation.evaluation_id ?? deterministicEvaluationId({ traceId, evaluation }),
    evaluatorId: evaluation.evaluator_id ?? deriveEvaluatorId(evaluation.name),
    evaluatorType: "custom",
    evaluatorName: evaluation.name,
    traceId,
    isGuardrail: evaluation.is_guardrail ?? undefined,
    status,
    ...verdictFields(evaluation, status === "processed"),
    details: evaluation.details ?? null,
    error: evaluation.error?.message ?? null,
    errorDetails: evaluation.error?.stacktrace?.join("\n") ?? null,
    costId: evaluation.cost_id ?? null,
    occurredAt,
  };
}

/**
 * Reports one SDK evaluation through the reportEvaluation command, returning
 * the failure instead of throwing so the caller can attempt the rest of the
 * span's evaluations first.
 */
async function reportOneEvaluation({
  deps,
  tenantId,
  traceId,
  evaluation,
  occurredAt,
}: {
  deps: CustomEvaluationSyncSubscriberDeps;
  tenantId: string;
  traceId: string;
  evaluation: SdkEvaluation;
  occurredAt: number;
}): Promise<Error | undefined> {
  const payload = buildReportPayload({
    tenantId,
    traceId,
    evaluation,
    occurredAt,
    deriveEvaluatorId: deps.deriveEvaluatorId,
  });

  try {
    await deps.reportEvaluation(payload);
    return undefined;
  } catch (error) {
    logger.error(
      {
        tenantId,
        traceId,
        evaluationId: payload.evaluationId,
        evaluatorId: payload.evaluatorId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to sync custom evaluation",
    );
    return error instanceof Error ? error : new Error(String(error));
  }
}

export function customEvaluationSyncDedupId(event: TraceProcessingEvent): string {
  return `${event.tenantId}:${event.aggregateId}:${event.id}`;
}

/**
 * Extracts SDK evaluations directly from OTLP span events: reads
 * `langwatch.evaluation.custom` events from the raw span and parses each
 * `json_encoded_event` attribute.
 */
export function extractEvaluationsFromSpan(span: OtlpSpan): SdkEvaluation[] {
  const evaluations: SdkEvaluation[] = [];
  for (const event of span.events ?? []) {
    const jsonPayload = readEvaluationPayload(event);
    if (typeof jsonPayload !== "string") continue;
    const evaluation = parseEvaluation(jsonPayload);
    if (evaluation) evaluations.push(evaluation);
  }
  return evaluations;
}

/**
 * Total, non-throwing relevance guard, evaluated both pre-enqueue and
 * again in the handler's fail-open path: only recent span events (not a
 * resync) carrying `langwatch.evaluation.custom` need this subscriber.
 */
export function hasSyncableEvaluations(event: TraceProcessingEvent): boolean {
  if (!isSpanReceivedEvent(event)) return false;
  if (event.occurredAt < nowInstant().epochMilliseconds - STALE_TRACE_THRESHOLD_MS) return false;
  return spanHasEvaluationEvents(event.data.span);
}

/** Syncs custom SDK evaluations to pipeline. Reads langwatch.evaluation.custom
 * from OTLP spans, dispatches reportEvaluation atomically with deterministic
 * IDs for idempotency. */
export function createCustomEvaluationSyncHandler(
  deps: CustomEvaluationSyncSubscriberDeps,
): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  return async (event, context) => {
    const isSyncableSpanEvent = hasSyncableEvaluations(event) && isSpanReceivedEvent(event);
    if (!isSyncableSpanEvent) return;

    const { tenantId, aggregateId: traceId } = context;

    const evaluations = extractEvaluationsFromSpan(event.data.span);
    if (evaluations.length === 0) return;

    logger.debug(
      { tenantId, traceId, evaluationCount: evaluations.length },
      "Syncing custom SDK evaluations",
    );

    const errors = await reportEvaluations({
      deps,
      tenantId,
      traceId,
      evaluations,
      occurredAt: event.occurredAt,
    });

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
