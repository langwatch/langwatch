/**
 * Customer-reported evaluations, read back out of trace's spans: derived ids so redelivery
 * replaces rather than duplicates, and a payload that must parse before anything is reported.
 */

import crypto from "node:crypto";

import type { ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  type OtlpSpan,
  type SdkEvaluation,
  sdkEvaluationSchema,
  spanSchema,
  STALE_TRACE_THRESHOLD_MS,
} from "@langwatch/trace-contract";
import { z } from "zod";

const logger = createLogger("langwatch:evaluation:trace-custom-evaluation-sync");

export const CUSTOM_EVAL_SYNC_DELAY_MS = 5_000;
export const CUSTOM_EVAL_SYNC_DEDUP_TTL_MS = 30_000;

export interface CustomEvaluationSyncSubscriberDeps {
  reportEvaluation: (data: ReportEvaluationCommandData) => Promise<void>;
  /** The evaluator id an SDK evaluation naming no `evaluator_id` gets (the autoslug rule). */
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

function extractEvaluationPayload(event: OtlpSpanEvent): string | undefined {
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
function spanHasEvaluationEvents(span: Pick<OtlpSpan, "events">): boolean {
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
    const report = await reportOneEvaluation({
      deps,
      tenantId,
      traceId,
      evaluation,
      occurredAt,
    });
    if (report.outcome === "failed") errors.push(report.error);
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
type EvaluationReport = { outcome: "reported" } | { outcome: "failed"; error: Error };

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
}): Promise<EvaluationReport> {
  const payload = buildReportPayload({
    tenantId,
    traceId,
    evaluation,
    occurredAt,
    deriveEvaluatorId: deps.deriveEvaluatorId,
  });

  try {
    await deps.reportEvaluation(payload);
    return { outcome: "reported" };
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
    return { outcome: "failed", error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** All of span_received this subscriber reads: the span's events. */
export const traceCustomEvaluationSpanSchema = z.object({
  span: spanSchema.pick({ events: true }),
});

/** One job per span event: two spans of a trace each carry their own evaluations. */
export function traceCustomEvaluationSyncDedupId(event: {
  tenantId: string;
  aggregateId: string;
  id: string;
}): string {
  return `subscriber:traceCustomEvaluationSync:${event.tenantId}:${event.aggregateId}:${event.id}`;
}

/**
 * Extracts SDK evaluations directly from OTLP span events: reads
 * `langwatch.evaluation.custom` events from the raw span and parses each
 * `json_encoded_event` attribute.
 */
export function extractEvaluationsFromSpan(span: Pick<OtlpSpan, "events">): SdkEvaluation[] {
  const evaluations: SdkEvaluation[] = [];
  for (const event of span.events ?? []) {
    const jsonPayload = extractEvaluationPayload(event);
    if (typeof jsonPayload !== "string") continue;
    const evaluation = parseEvaluation(jsonPayload);
    if (evaluation) evaluations.push(evaluation);
  }
  return evaluations;
}

/** Pre-enqueue relevance: only a span carrying `langwatch.evaluation.custom` mints a job. */
export function hasSyncableEvaluations(
  data: z.output<typeof traceCustomEvaluationSpanSchema>,
): boolean {
  return spanHasEvaluationEvents(data.span);
}

/**
 * Evaluation's peer reaction to trace's span_received (§9): reports the SDK evaluations a
 * recent span carries on evaluation's own reportEvaluation command, with deterministic ids
 * so a redelivery replaces rather than duplicates. A resync's stale span reports nothing.
 */
export function createTraceCustomEvaluationSync(
  deps: CustomEvaluationSyncSubscriberDeps,
): (input: {
  tenantId: string;
  traceId: string;
  occurredAt: number;
  span: Pick<OtlpSpan, "events">;
}) => Promise<void> {
  return async ({ tenantId, traceId, occurredAt, span }) => {
    if (occurredAt < nowInstant().epochMilliseconds - STALE_TRACE_THRESHOLD_MS) return;
    const evaluations = extractEvaluationsFromSpan(span);
    if (evaluations.length === 0) return;

    logger.debug(
      { tenantId, traceId, evaluationCount: evaluations.length },
      "Syncing custom SDK evaluations",
    );
    const errors = await reportEvaluations({ deps, tenantId, traceId, evaluations, occurredAt });
    logger.debug(
      { tenantId, traceId, evaluationCount: evaluations.length, failedCount: errors.length },
      "Custom SDK evaluations synced",
    );

    if (errors.length > 0) throw errors[0];
  };
}
