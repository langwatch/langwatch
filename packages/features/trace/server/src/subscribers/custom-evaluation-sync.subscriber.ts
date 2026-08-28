import crypto from "node:crypto";
import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { STALE_TRACE_THRESHOLD_MS } from "@langwatch/trace-contract";
import { isSpanReceivedEvent, type TraceProcessingEvent } from "@langwatch/trace-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";

const logger = createLogger("langwatch:trace-processing:custom-evaluation-sync");

export const CUSTOM_EVAL_SYNC_DELAY_MS = 5_000;
export const CUSTOM_EVAL_SYNC_DEDUP_TTL_MS = 30_000;

export function customEvaluationSyncDedupId(event: TraceProcessingEvent): string {
  return `${event.tenantId}:${event.aggregateId}:${event.id}`;
}

export interface CustomEvaluationSyncSubscriberDeps {
  reportEvaluation: (data: ReportEvaluationCommandData) => Promise<void>;
  /**
   * The evaluator id an SDK evaluation gets when it names no `evaluator_id`.
   *
   * Evaluation owns the slug rule (the same one the collector and the legacy
   * evaluations route apply), so the rule is injected rather than restated
   * here: a Trace-local copy would drift and silently re-key every custom
   * evaluator it derives.
   */
  deriveEvaluatorId: (evaluationName: string) => string;
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

type OtlpSpanEvent = NonNullable<OtlpSpan["events"]>[number];

function readEvaluationPayload(event: OtlpSpanEvent): string | undefined {
  if (event.name !== EVAL_EVENT_NAME) return undefined;
  const jsonAttr = event.attributes.find((attr) => attr.key === "json_encoded_event");
  return jsonAttr?.value && "stringValue" in jsonAttr.value
    ? (jsonAttr.value.stringValue ?? undefined)
    : undefined;
}

function parseEvaluation(jsonPayload: string): SdkEvaluation | undefined {
  try {
    const parsed: unknown = JSON.parse(jsonPayload);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (typeof record.name !== "string") return undefined;
    return record as unknown as SdkEvaluation;
  } catch {
    logger.warn(
      { payloadLength: jsonPayload.length },
      "Failed to parse json_encoded_event from evaluation span event",
    );
    return undefined;
  }
}

/**
 * Extracts SDK evaluations directly from OTLP span events.
 *
 * Reads `langwatch.evaluation.custom` events from the raw OTLP span,
 * parses the `json_encoded_event` attribute from each.
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
): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  return async (event, context) => {
    if (!hasSyncableEvaluations(event) || !isSpanReceivedEvent(event)) return;

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
 * errored/skipped run's stray passed/score/label must not reach
 * analytics or triggers as a real result (#6833). Same gate as the shared
 * verdictGate helpers now applied at the executeEvaluation command boundary.
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
