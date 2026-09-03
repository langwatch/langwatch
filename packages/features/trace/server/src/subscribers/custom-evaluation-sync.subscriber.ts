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

const EVAL_EVENT_NAME = "langwatch.evaluation.custom";

type OtlpSpanEvent = NonNullable<OtlpSpan["events"]>[number];

/**
 * Customer-reported evaluations, read back out of the spans that carried them.
 *
 * The counterpart to {@link TrackedEventSync} and the same shape: derived ids
 * so a redelivery replaces rather than duplicates, and a payload that must
 * parse before anything is reported.
 */
export class CustomEvaluationSync {
  /**
   * Generates a deterministic evaluation ID by hashing the evaluation JSON.
   * Matches the legacy `mapEvaluations` behavior for idempotency.
   */
  private static deterministicEvaluationId({
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

  private static readEvaluationPayload(event: OtlpSpanEvent): string | undefined {
    if (event.name !== EVAL_EVENT_NAME) return undefined;
    const jsonAttr = event.attributes.find((attr) => attr.key === "json_encoded_event");
    return jsonAttr?.value && "stringValue" in jsonAttr.value
      ? (jsonAttr.value.stringValue ?? undefined)
      : undefined;
  }

  private static parseEvaluation(jsonPayload: string): SdkEvaluation | undefined {
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
   * Cheap presence check — no JSON.parse. The predicate runs on the projection
   * hot path with attacker-supplied span payloads, so it only looks for an
   * evaluation event carrying a string payload; full parsing and validation
   * stay in the handler off the hot path.
   */
  private static spanHasEvaluationEvents(span: OtlpSpan): boolean {
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
  private static async reportEvaluations({
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
      const failure = await CustomEvaluationSync.reportOneEvaluation({
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
  private static verdictFields(evaluation: SdkEvaluation, hasVerdict: boolean) {
    return {
      score: hasVerdict ? (evaluation.score ?? null) : null,
      passed: hasVerdict ? (evaluation.passed ?? null) : null,
      label: hasVerdict ? (evaluation.label ?? null) : null,
    };
  }

  private static buildReportPayload({
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
      evaluationId:
        evaluation.evaluation_id ??
        CustomEvaluationSync.deterministicEvaluationId({ traceId, evaluation }),
      evaluatorId: evaluation.evaluator_id ?? deriveEvaluatorId(evaluation.name),
      evaluatorType: "custom",
      evaluatorName: evaluation.name,
      traceId,
      isGuardrail: evaluation.is_guardrail ?? undefined,
      status,
      ...CustomEvaluationSync.verdictFields(evaluation, status === "processed"),
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
  private static async reportOneEvaluation({
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
    const payload = CustomEvaluationSync.buildReportPayload({
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

  static customEvaluationSyncDedupId(event: TraceProcessingEvent): string {
    return `${event.tenantId}:${event.aggregateId}:${event.id}`;
  }

  /**
   * Extracts SDK evaluations directly from OTLP span events.
   *
   * Reads `langwatch.evaluation.custom` events from the raw OTLP span,
   * parses the `json_encoded_event` attribute from each.
   */
  static extractEvaluationsFromSpan(span: OtlpSpan): SdkEvaluation[] {
    const evaluations: SdkEvaluation[] = [];
    for (const event of span.events ?? []) {
      const jsonPayload = CustomEvaluationSync.readEvaluationPayload(event);
      if (typeof jsonPayload !== "string") continue;
      const evaluation = CustomEvaluationSync.parseEvaluation(jsonPayload);
      if (evaluation) evaluations.push(evaluation);
    }
    return evaluations;
  }

  /**
   * Total, non-throwing relevance guard. As the subscriber's `when` it is
   * evaluated both pre-enqueue (a filtered event never pays serialization) and
   * again in the handler on the fail-open path: only span events that are
   * recent (not a resync) and actually carry `langwatch.evaluation.custom`
   * events need this subscriber.
   */
  static hasSyncableEvaluations(event: TraceProcessingEvent): boolean {
    if (!isSpanReceivedEvent(event)) return false;
    if (event.occurredAt < Date.now() - STALE_TRACE_THRESHOLD_MS) return false;
    return CustomEvaluationSync.spanHasEvaluationEvents(event.data.span);
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
  static createCustomEvaluationSyncHandler(
    deps: CustomEvaluationSyncSubscriberDeps,
  ): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
    return async (event, context) => {
      if (!CustomEvaluationSync.hasSyncableEvaluations(event) || !isSpanReceivedEvent(event))
        return;

      const { tenantId, aggregateId: traceId } = context;

      const evaluations = CustomEvaluationSync.extractEvaluationsFromSpan(event.data.span);
      if (evaluations.length === 0) return;

      logger.debug(
        { tenantId, traceId, evaluationCount: evaluations.length },
        "Syncing custom SDK evaluations",
      );

      const errors = await CustomEvaluationSync.reportEvaluations({
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
}
